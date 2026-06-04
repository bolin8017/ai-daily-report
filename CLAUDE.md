# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

An AI-powered daily creative tech brief for **AI engineers who build** (RAG / VLM / fine-tuning / agent / MCP). Every day, a Claude Code agent collects signals from GitHub Trending, GitHub topic search (freshness-first, ≤30-day-old repos), GitHub developer activity, Hacker News, Lobsters, Dev.to, Anthropic News, HuggingFace Daily Papers, and ~10 other RSS sources (Simon Willison, Karpathy, Gary Marcus, Google AI Blog, Phoronix, LWN, etc.), then synthesizes them into a deep analyst-style brief published to GitHub Pages.

The tone is **senior analyst briefing a busy CTO** — FT / Bloomberg / The Information / Stratechery voice — not corporate marketing. Mechanism over metaphor, specific over generic, builder-oriented action advice over decision-maker strategy talk. The audience is deliberately locked to builders (not PMs, not founders, not decision-makers); if a section drifts into "talk to your CTO about vendor strategy" territory, the prompt's Step 7 self-check catches it.

For the public-facing overview and quick start, see [README.md](./README.md). For design decisions and trade-offs, see [docs/architecture.md](./docs/architecture.md).

## Deployment mode

The pipeline is split into **four stages**. During the Hermes migration it can run either through the legacy Docker/systemd wrapper or directly under Hermes/local operator control; the active data contract is repo-local staging plus Hermes Wiki context, not repo-local memory.

- **Stage 1 — collect** (`src/collect.js`): pure Node.js — fetches 8 sources in parallel (feeds, github-trending, github-search with topic rotation, github-developers, leaderboards, mops, hf-trending, arxiv), condenses each to ≤8500 tokens, builds the feeds snapshot, writes condensed data to `data/staging/`. **Does not commit** — staging is Docker-volume-only; the feeds snapshot it builds is committed later by Stage 4 for the 11ty footer (see "Storage" below).
- **Stage 2 — curate** (`scripts/curate.sh`): 4 parallel `claude -p --model claude-haiku-4-5` subprocesses (one per section: shipped / pulse / market / tech). Each reads its staging slice, applies its prompt at `themes/<ACTIVE_THEME>/sections/<section>/curator.md`, writes validated JSON to `data/staging/curated/<section>.json`. Critical sections (shipped, pulse) failure aborts; non-critical (market, tech) failure logs degraded.
- **Stage 2.5 — context** (`scripts/hermes/build-report-context.mjs`): builds a bounded `data/staging/report-context.md` from the local Hermes Wiki (`/home/bolin8017/Documents/Hermes/Wiki`) plus current run metadata. This is the only cross-day intelligence input for Stage 3.
- **Stage 3 — synthesize** (`scripts/synthesize.sh`): single `claude -p --model claude-sonnet-4-6` invocation. Reads curated/* + raw staging + `data/staging/report-context.md`, applies `themes/<ACTIVE_THEME>/synthesizer.md` + `quality.md`, and writes **only the editorial layer** to `data/staging/editorial.json` (lead / signals / ideation, `EditorialSchema 2.1-editorial`). It does **not** emit curated sub-groups and no longer reads or writes `data/memory.json` — the editorial/merge split is what fixed the 32K output-token cap on 2026-05-24.
- **Stage 4 — merge** (`scripts/merge-report.sh` → `src/lib/merge.js`): pure Node, no LLM, idempotent. Composes the final `data/reports/<date>.json` (ReportSchema 2.1) from `editorial.json` + `curated/*.json`, validating that every `source_links` id exists in the curated outputs (aborts on dangling references).

`scripts/analyze.sh` orchestrates Stage 2 → Stage 2.5 → Stage 3 → Stage 4 → validate → commit (reports + feeds snapshot; no memory commit). The earlier `FEATURE_NEW_PIPELINE=0` lens-based single-stage path has been removed; the v1.x reports it produced before 2026-05-22 still live on the `data` branch and render through the templates' legacy lens partial.

GitHub Actions deploys the 11ty site to Pages on a push to `main` (code/site changes) or on a `repository_dispatch` the VM fires after committing the day's report to the `data` branch (`data`-branch pushes can't trigger workflows themselves).

## Branch layout

Two long-lived branches with distinct roles:

- **`main`**: human-authored source — code, templates, CI, scripts, config. Bot never pushes here.
- **`data`** (orphan branch, no shared history with `main`): bot-produced public artifacts — `data/reports/` (rolling 60-day hot window) and `data/feeds-snapshot.json` (small, overwritten each run — the 11ty footer reads it at build time). `data/memory.json` is retired from the active pipeline; cross-day intelligence lives in the local Hermes Wiki and is projected into `data/staging/report-context.md` per run. Only the merge + commit step (Stage 4 / `analyze.sh`) lands public artifacts here. Staging is not committed; older reports archive to GitHub Releases (see "Storage").

`src/lib/commit.js` builds commits using git plumbing (`read-tree` into an isolated `GIT_INDEX_FILE`, `write-tree`, `commit-tree`, then `push commit:refs/heads/data`) — never checks out the data branch, never touches main's working tree or index. It also has a `--remove` mode (used by the monthly archive job to delete archived reports from the data branch). In CI the build job checks out `main` for code, then `git fetch` + `git checkout refs/remotes/origin/data -- data/` to pull in the recent reports, then hydrates older months from Releases before running 11ty.

**Production runtime**: target production is Hermes cron at 07:00 Asia/Taipei, delivered back to Telegram on failure or notable completion. The previous Google Cloud e2-micro VM + systemd timer + Docker wrapper remains in the repo as a legacy migration path until Hermes dry-run and first successful no-memory report are verified. A monthly archive job is still required for hot/cold report storage.

**Why stages split from one process**: the original `pipeline.js` called `claude -p` as a subprocess from Node.js, which hung indefinitely due to FD table / SSE keepalive interactions. Splitting the LLM stages into bash-invoked `claude -p` calls (no Node parent) avoids the hang and gives the agent native tool access (Read/Write) instead of piping 50KB+ through the prompt body. The later editorial/merge split (Stage 3 → Stage 4) additionally keeps LLM output small (~3-5K tokens) so it never hits the output-token cap.

**Legacy VM environment requirements** (managed by `scripts/setup-vm.sh`; retained only for migration / rollback):

| Setting | Value | Why |
|---|---|---|
| **Swap** | 2GB file at `/swapfile` | e2-micro has limited RAM. LLM synthesis peaks need headroom to avoid OOM. |
| **Docker image** | `ai-daily-report:latest`, built locally from `Dockerfile` | Contains Node 22 + git + `@anthropic-ai/claude-code` CLI. No project code baked in — code flows via `git pull` on each run. |
| **Docker volume** | `ai-daily-report-workspace` | Persists the cloned repo + `node_modules` between runs so cold starts stay <10s. |
| **Claude auth** | Bind mount `~/.claude` from host → `/home/pipeline/.claude` in container (read-write) | One-time interactive `claude /login` inside the container creates credentials that persist across timer invocations. Mount must be writable so the CLI can refresh the OAuth token before expiry — a read-only mount deadlocks the pipeline (see commit `faea48e` "fix(docker): let claude cli refresh oauth token" for the failure mode). |
| **Secrets** | `~/.ai-daily-report.env` with `GITHUB_TOKEN=ghp_...` | Loaded by `scripts/cron-run.sh`, injected into container via `-e GITHUB_TOKEN`. |
| **Memory limits** | `docker run --memory=600m --memory-swap=1g` | Caps the pipeline so an OOM never kills the host's other services. |
| **Scheduling** | legacy systemd timer (`systemd/ai-daily-report.timer`) | Legacy rollback path. Target production scheduling is Hermes cron at 07:00 Asia/Taipei. |

## How to Run

| Command | What it does |
|---|---|
| `npm start` | Local dev: runs `scripts/run.sh` → Stage 1 only (fetch + snapshot + condense, no push, no LLM). |
| `bash scripts/run.sh --full` | Stage 1 → 2 → 3 → 4 (requires host Claude Code login). |
| `bash scripts/run.sh --skip-push` | Stages 1–4; writes outputs to local `data/` but skips commit/push. Inspect the result by reading the files directly (e.g. `jq . data/reports/$(date +%F).json`). |
| `bash scripts/run.sh --analyze` | Stages 2–4 only (assumes `data/staging/` is populated — run Stage 1 first, or hydrate from `data` branch: `git fetch origin data && git checkout origin/data -- data/`). |
| `npm run collect` / `npm run collect:dry` | Direct invocation of `node src/collect.js` with or without `--skip-push`. |
| `npm run analyze` | Direct invocation of `bash scripts/analyze.sh` (curate → synthesize → merge → commit). |
| `node src/fetchers/feeds.js` | Any single fetcher can still be run standalone; all fetchers are dual-mode (importable + CLI). |
| `node src/lib/condense.js` | Standalone mode reads `tmp/*.json`, writes `tmp/*-condensed.json` — useful for debugging the condense budget. |
| `bash scripts/merge-report.sh [DATE]` | Re-run Stage 4 alone against existing `editorial.json` + `curated/*` (debug the merge / dangling-link check without re-invoking the LLM). |
| `ACTIVE_THEME=<name> bash scripts/run.sh --full` | Run the pipeline against an alternate theme directory. |
| `npm run build` | Rebuild the static site. Requires `data/` populated locally — either run Stage 1 first, or `git fetch origin data && git checkout origin/data -- data/`. |
| `npm run serve` | 11ty dev server with live reload. |
| `npm test` | Vitest unit tests for schemas + condense + theme loader + merge. |
| `npm run lint` / `npm run format` | Biome check / format --write. |
| `npm run check:sources` | Verify `docs/data-sources.md` is in sync with `themes/<ACTIVE_THEME>/sources.yaml`. |
| `npm run validate:report` | Validate the newest report in `data/reports/` against the composed `ReportSchema`. |

**Legacy VM operations** (only if using the rollback VM path):
- `bash scripts/setup-vm.sh` — one-time install (swap + Docker + both systemd timers + image build). Idempotent.
- `sudo systemctl start ai-daily-report.service` — one-off manual daily run.
- `sudo systemctl start ai-daily-report-archive.service` — one-off manual monthly archive run.
- `journalctl -u ai-daily-report --since today` — view latest run logs (`-u ai-daily-report-archive` for the archive job).
- `systemctl list-timers 'ai-daily-report*'` — check next scheduled runs (daily + monthly archive).

## Project Structure

```
.
├── src/
│   ├── collect.js                # Stage 1 entry — fetch → condense → snapshot → write staging (no commit)
│   ├── fetchers/                 # Provider-chain fetchers (dual-mode: importable + standalone CLI)
│   │   ├── providers/            # One file per provider; theme-aware ones read themes/<theme>/sources.yaml
│   │   ├── run-all.js            # Parallel chain runner — used by collect.js
│   │   └── _dispatch.js          # Shared helper that detects CLI mode and emits JSON
│   ├── curators/                 # Stage 2 curator orchestrators (_base.js resolves theme curator paths)
│   ├── schemas/                  # Zod schemas (single source of truth)
│   │   ├── config.js             # Minimal post-cutover config (providers + report only)
│   │   ├── editorial.js          # EditorialSchema (Stage 3 output: lead/signals/ideation)
│   │   ├── report.js             # ReportSchema + buildReportSchema() dynamic composer
│   │   └── staging.js            # Stage 1 → Stage 2 contract (metadata shape)
│   └── lib/
│       ├── config.js             # Validated config singleton + ACTIVE_THEME / HOT_DAYS / HYDRATE_MONTHS
│       ├── theme.js              # Theme loader (loadTheme / loadSection / getThemeSources)
│       ├── sources.js            # resolveEffectiveSources() — base registry + theme phison_overlay
│       ├── scope.js              # tagItemScope(item, theme) — boost theme-overlay items in condense
│       ├── merge.js              # Stage 4 composeReport() + dangling-source_link check
│       ├── condense.js           # Per-source ≤8500-token condenser (dual-mode)
│       ├── snapshot.js           # feeds-snapshot.json builder (dual-mode)
│       ├── commit.js             # git plumbing add/commit/push + --remove mode (archive job)
│       └── validate.js           # CLI schema validator
├── themes/                       # Swappable persona/voice/source/section bundles (see "Themes")
│   └── ai-builder/               # Default theme — theme.yaml, sources.yaml, ui-strings.yaml,
│                                 #   synthesizer.md, quality.md, sections/<id>/{manifest,curator,schema,partial}
├── scripts/
│   ├── analyze.sh                # Stage 2→2.5→3→4 orchestrator: curate → context → synthesize → merge → validate → commit
│   ├── curate.sh                 # Stage 2 — 4 parallel claude -p (Haiku) + watchdog
│   ├── synthesize.sh             # Stage 2.5/3 — build report-context, then single claude -p (Sonnet) → editorial.json
│   ├── merge-report.sh           # Stage 4 — mechanical compose editorial + curated → report.json
│   ├── run.sh                    # Local dev wrapper (default: Stage 1 only, --full for all stages)
│   ├── cron-run.sh               # Daily Docker invocation — host git pull + image rebuild + docker run
│   ├── cron-archive.sh           # Monthly archive Docker invocation (host wrapper)
│   ├── archive-month.sh          # Package reports >HOT_DAYS → GitHub Releases (curl + REST API)
│   ├── hydrate-archive.sh        # CI build helper — pull last HYDRATE_MONTHS from Releases
│   ├── docker-entrypoint.sh      # Inside-container entry: git pull + npm ci + collect/analyze/both/archive
│   ├── watchdog.sh               # /proc/$PID/io + CPU liveness monitor for claude -p
│   └── setup-vm.sh               # One-time VM setup: swap + Docker + both systemd timers + OAuth
├── systemd/                      # systemd units (installed by setup-vm.sh)
│   ├── ai-daily-report.service / .timer          # Daily 07:00 Asia/Taipei
│   ├── ai-daily-report-archive.service / .timer  # Monthly archive (1st, fires ~2nd 05:00 Taipei)
│   └── ai-daily-report-notify@.service           # Failure alert (optional webhook)
├── Dockerfile                    # node:22-slim + git + tini + @anthropic-ai/claude-code (no project code)
├── .dockerignore
├── site/                         # 11ty source templates (Nunjucks)
│   ├── _includes/                # base.njk, report-body.njk (schema-version dispatcher), v2/*, lens/* (legacy)
│   ├── assets/                   # style.css + app.js (tab + filter logic)
│   ├── feed.njk                  # RSS feed template
│   ├── index.njk                 # Main page (schema-version dispatcher → v2/unified.njk)
│   └── archive.njk               # Archive pages via 11ty pagination
├── tests/                        # Vitest (schemas, condense, theme loader, merge, scope, chain integration)
├── data/                         # .gitignored on main; public artifacts are committed to the `data` branch
│   ├── reports/                  # Daily reports (YYYY-MM-DD.json), rolling 60-day hot window
│   ├── staging/                  # Stage 1→2→2.5→3 working files (not committed; includes report-context.md)
│   └── feeds-snapshot.json       # Condensed snapshot for 11ty templates (rebuilt each run, committed for the footer/feed lists)
├── docs/                         # Project documentation (architecture, data-sources, firewall, specs)
├── _site/                        # 11ty build output (gitignored — built in CI)
├── .github/workflows/deploy.yml  # CI: hydrate archive → build → deploy to GitHub Pages via OIDC
├── config.json                   # Minimal: providers (firecrawl/jina tuning) + report rendering
├── biome.json                    # Biome lint + format config
└── eleventy.config.js            # 11ty build config (ESM) — loads active theme ui-strings + manifest
```

> The `.claude/` directory holds machine settings + rules only. The active pipeline's prompts live under `themes/<ACTIVE_THEME>/`.

## Data Sources

> Authoritative per-source list (URLs, categories, Phison overlay) lives in [docs/data-sources.md](./docs/data-sources.md). Run `npm run check:sources` after changing `themes/<ACTIVE_THEME>/sources.yaml` to confirm the doc still matches.

Sources are fetched through **per-source provider chains** (`src/fetchers/providers/*` + `run-chain.js` / `run-all.js`): each source declares an ordered chain of providers (e.g. RSSHub → native RSS → Jina Reader → Firecrawl) so one provider failing falls through to the next. The base source list lives in `src/sources/registry.js`; the active theme's `sources.yaml` adds a `phison_overlay` (Phison-specific feeds + topics) on top.

Key source families:
- **Community feeds** (RSSHub instances tried in order from `themes/<theme>/sources.yaml → rsshub_urls`, plus native RSS / JSON): Hacker News (enriched via Algolia for scores/comments), Dev.to, Lobsters, Anthropic News, HuggingFace Daily Papers, Simon Willison, Karpathy, Gary Marcus, Google AI Blog, Phoronix, LWN, Chinese-community + Taiwan-media sources, etc.
- **GitHub Trending** (`github-trending-html.js`): scrapes `github.com/trending`, enriches each repo via Octokit.
- **GitHub topic search** (`github-search-api.js`): freshness-first `topic:X stars:>100 created:>30daysAgo` + README excerpt; feeds the **discovery picks** slot inside `shipped`. Topics come from `themes/<theme>/sources.yaml → github_topics` (a `tier.core` always-on set + `tier.rotating` set sampled per day).
- **GitHub developer watch** (`github-developers-api.js`): top global + per-region (Taiwan) developers' newest repos within a 72h window → feeds `shipped.dev_watch_*`.
- **Leaderboards / MOPS / HF trending / arXiv**: structured fetchers written raw to staging (no condense step).

## Schemas (Zod, single source of truth)

All data shapes are validated against Zod schemas in `src/schemas/`:

| Schema | Validates | Used at |
|---|---|---|
| `ConfigSchema` | `config.json` (now just `providers` + `report`) | Startup, in `src/lib/config.js` |
| `StagingMetadataSchema` | `data/staging/metadata.json` | `src/collect.js` before writing (Stage 1 → Stage 2 contract) |
| section `schema.js` (per theme section) | each `data/staging/curated/<section>.json` | Stage 2 curators after writing |
| `EditorialSchema` | `data/staging/editorial.json` | `scripts/synthesize.sh` after Stage 3 |
| `ReportSchema` / `buildReportSchema()` | `data/reports/YYYY-MM-DD.json` | Stage 4 merge + `scripts/analyze.sh` validate |

`buildReportSchema(theme)` composes the report schema at runtime from the active theme's section `schema.js` modules + the static editorial blocks (lead / signals / ideation), so adding a section never requires editing `report.js`. `resolveReportSchema()` returns it.

**If validation fails, the pipeline aborts.** This catches schema drift between LLM output and template expectations early — before broken data reaches `_site/`.

Note: `ReportSchema` uses `.passthrough()` at the top level and makes most sub-fields optional. This is intentional: the LLM output shape drifts slightly. A strict schema would reject cosmetically varied but semantically valid reports. `schema_version` accepts both `2` (legacy, pre-2026-05-24) and `2.1` (post-cutover editorial+merge); both render via the same v2 unified partial.

## Output

- **Static HTML** built in CI by 11ty, deployed to GitHub Pages via `actions/deploy-pages@v4` (OIDC artifact, not a `gh-pages` branch).
- **Live URL:** https://bolin8017.github.io/ai-daily-report
- **Archive:** recent `data/reports/YYYY-MM-DD.json` live on the `data` branch (60-day hot window); older months archive to GitHub Releases and are hydrated back at build time. 11ty pagination generates `_site/archive/YYYY-MM-DD.html`. Footer shows last 7; all reports kept permanently (hot on branch, cold in Releases).
- **RSS feed:** `_site/feed.xml`

## State Management

Public artifacts are hydrated into the working tree by the legacy Docker entrypoint and by `.github/workflows/deploy.yml` on each CI build. Cross-day intelligence is intentionally local-only in Hermes Wiki.

- `/home/bolin8017/Documents/Hermes/Wiki` — local Hermes Wiki intelligence store. It is not committed to GitHub and is the durable home for themes, arcs, and monitoring notes.
- `data/staging/report-context.md` — bounded per-run context generated from Hermes Wiki for Stage 3. It is staging-only and not committed.
- `data/reports/YYYY-MM-DD.json` (on `data` branch, 60-day hot window) — daily reports composed by Stage 4. 11ty reads this directory to generate archive pages.
- `data/staging/` — **ephemeral** (not committed). Holds Stage 1 condensed files + `metadata.json` + Stage 2 `curated/*` + Stage 2.5 `report-context.md` + Stage 3 `editorial.json`.
- `data/feeds-snapshot.json` — rebuilt each Stage 1 run and **committed by Stage 4** (small, overwritten daily). The 11ty footer source-status pills + community feed lists read it at build time, and CI builds from the `data` branch, so it must be committed or the footer renders a stale snapshot.
- **Cold archive** — reports older than `HOT_DAYS` (60) live in GitHub Releases as `archive-YYYY-MM` tags (`reports-YYYY-MM.tar.gz` + sha256), produced by the monthly archive job.

`data/memory.json` and its `MemorySchema` have been removed from the codebase; cross-day intelligence now lives only in the local Hermes Wiki, projected per run into `data/staging/report-context.md`. The file is already absent from the `data` branch.

## Environment

Required:
- `GITHUB_TOKEN` — PAT with `Contents: read/write` scope. Used by Octokit fetchers AND as the commit/push credential inside the container (see `src/lib/commit.js`, which injects the token as an `http.extraheader` via Git 2.31+'s `GIT_CONFIG_COUNT` env vars — the same mechanism `actions/checkout` uses — so the token never touches `.git/config` or the remote URL). On the VM, stored in `~/.ai-daily-report.env`. Locally, loaded from `.env`.
- **Claude Code subscription** — `claude -p` in Stage 2/3 draws from the Max subscription (not API billing). Credentials live in `~/.claude` and are bind-mounted into the container.
- **RSSHub** — `themes/<ACTIVE_THEME>/sources.yaml → rsshub_urls` is an ordered list of public instances. The rsshub provider tries each URL in order per request, falling through on `5xx` / timeout / network error. `4xx` is treated as a route-level error (no retry). See `sources.yaml` for the authoritative list.

Optional:
- `RSSHUB_URL` — env var override. Forces a single URL and **disables the fallback list** — intended for local debugging against a private instance. Production should leave this unset and let `sources.yaml` provide the ordered list.
- `REPORT_TIMEZONE` — default `Asia/Taipei`.
- `CLAUDE_MODEL` — override the model passed to `claude -p`; default `claude-opus-4-6`.
- `SKIP_PUSH=1` — skip `git push` in both stages; also accessible as `--skip-push` CLI flag on `src/collect.js`.
- `ACTIVE_THEME` — default `ai-builder`. Name of the theme directory under `themes/` to activate. See "Themes" section below.
- `HOT_DAYS` — default `60`. Reports newer than this stay on the `data` branch; older ones archive monthly to GitHub Releases.
- `HYDRATE_MONTHS` — default `12`. How many months of archived reports the CI build pulls back from Releases.

See `.env.example` for all variables.

## Themes

The pipeline reads its persona, voice, anti-slop rules, source list, and section definitions from `themes/<ACTIVE_THEME>/`. The default theme is `ai-builder`. The structure is designed so that swapping focus (e.g., from "AI builder" to "ML researcher" or "Web3 developer") becomes a single-directory edit rather than touching 8+ files across the repo.

### Theme structure

```
themes/<name>/
├── theme.yaml              # manifest: persona, model assignment, sections list
├── sources.yaml            # GitHub topics + RSS feed config (ported from config.json)
├── ui-strings.yaml         # tab labels, site title, archive strings
├── synthesizer.md          # editorial prompt — persona / voice (was .claude/synthesizer.md)
├── quality.md              # anti-slop rules (was .claude/daily-report-quality.md)
└── sections/
    ├── _shared.md          # shared curator prompt fragment
    └── <section-id>/
        ├── manifest.yaml   # id, tab_label, critical, audience_split, groups, paths
        ├── curator.md      # curator prompt for this section
        ├── schema.js       # Zod sub-schema for items in this section
        └── partial.njk     # 11ty render partial
```

### Swap-a-theme workflow

```bash
# 1. Copy current theme as starting point
cp -r themes/ai-builder themes/ml-researcher

# 2. Edit (everything in one directory)
#    themes/ml-researcher/theme.yaml          — display name, persona, focus
#    themes/ml-researcher/synthesizer.md      — voice / audience / editorial prompt
#    themes/ml-researcher/sources.yaml        — relevant feeds, GitHub topics
#    themes/ml-researcher/sections/*/curator.md
#    themes/ml-researcher/ui-strings.yaml     — tab labels

# 3. Switch
ACTIVE_THEME=ml-researcher bash scripts/run.sh --full
```

### Add-a-section workflow

```bash
mkdir -p themes/ai-builder/sections/research
# Write manifest.yaml + curator.md + schema.js + partial.njk
# Add to themes/ai-builder/theme.yaml `sections:` list:
#   - id: research
#     order: 55
#     critical: false
```

The pipeline's next run automatically picks up the new section — no edits needed in `src/`, `scripts/`, or `eleventy.config.js`. Schema composition is dynamic via `buildReportSchema()` (see `src/schemas/report.js`); 11ty partial discovery is configured in `eleventy.config.js`.

### Theme loader API

`src/lib/theme.js`:
- `loadTheme(name)` — returns parsed manifest + resolved paths + sources + ui_strings
- `loadSection(theme, id)` — returns section manifest with resolved paths (curator/schema/partial)
- `listActiveSections(theme)` — returns all sections in display order

Used by `src/curators/_base.js` (curator prompt resolution), `src/lib/sources.js` (`resolveEffectiveSources()`), and `src/schemas/report.js` (`buildReportSchema()`). Test coverage in `tests/theme.test.js`.

## CI/CD

| Workflow | Trigger | Job |
|---|---|---|
| `.github/workflows/deploy.yml` | (a) push to `main` matching the deploy paths (code/site/workflow changes), OR (b) pull_request matching the wider validation paths (`src/**`, `tests/**`, `scripts/**`, configs included), OR (c) `repository_dispatch` (type `data-committed`) that the VM POSTs at the end of each daily run via `scripts/cron-run.sh` — right after the report is pushed to `data` — OR (d) manual `workflow_dispatch`. Note: pushes to the `data` branch **do not** fire the workflow — the orphan `data` branch has no `.github/workflows/` tree, which is why the VM's `repository_dispatch` is the primary auto-deploy path for bot reports (it replaced a `schedule: '0 0 * * *'` poll that GitHub drifted by hours, lagging the published site by most of a morning). | `build` job runs always: checkout `main` → hydrate recent `data/` from `data` branch → **hydrate cold archive from Releases** (`scripts/hydrate-archive.sh`, best-effort) → lint + tests + schema validation + 11ty build. `deploy` job runs on every event except `pull_request`: `upload-pages-artifact` → `deploy-pages` OIDC. PR validation ends after `build`. Concurrency group is per-PR (cancel-in-progress) for PRs and shared `pages` for everything else. |

GitHub Pages source: **GitHub Actions** (`build_type: workflow`). No legacy `gh-pages` branch.

**Node 24 opt-in**: the workflow sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` at the top level so `actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact`, and `actions/deploy-pages` all run on Node 24. This is ahead of GitHub's 2026-06-02 forced migration (Node 20 removal from runners on 2026-09-16). Once all official action versions default to Node 24 (expected by June), the env var can be removed.

## Notes

- **Scheduling**: target production runs under Hermes cron at 07:00 Asia/Taipei, with Telegram reporting for failures/notable completion. The VM systemd timers (`ai-daily-report.timer`, `ai-daily-report-archive.timer`) remain a legacy rollback path during migration.
- **Schema-first**: when changing report sections, update the section's `themes/<theme>/sections/<id>/schema.js` first (the dynamic composer picks it up), then the curator prompt, then the section `partial.njk`. This catches mismatches at validate time.
- **Git push auth** — `src/lib/commit.js` injects `$GITHUB_TOKEN` as an `http.extraheader` via `GIT_CONFIG_COUNT` env vars (Git 2.31+). The token never touches `.git/config` or the remote URL, so a mid-pipeline container crash cannot leave the token persisted in the Docker volume. This is the same mechanism GitHub's own `actions/checkout` uses. `scripts/docker-entrypoint.sh` uses the same pattern for clone/fetch. The archive job's Releases uploads use plain `curl` with the same token (no gh CLI on the VM).
- **External RSSHub dependency** — `themes/<theme>/sources.yaml → rsshub_urls` lists public instances tried in order. The rsshub provider falls through automatically on any per-request error (timeout, 5xx, network), so a single instance going slow or down degrades one request, not the whole run. `run-all.js` additionally tolerates a fraction of sources failing at the chain level. To add a new instance, append its URL to the list; to force one instance for debugging, set `RSSHUB_URL=...` (which bypasses the list).
- **Provider-chain fetchers** — each source declares an ordered provider chain; `src/fetchers/providers/*` files register providers and `run-chain.js` walks the chain falling through on failure. Theme-aware providers (`rsshub.js`, `github-search-api.js`, `github-developers-api.js`) read their config from `themes/<theme>/sources.yaml` via `getThemeSources()`.
- Report sections (schema 2.1 unified, prompts in `themes/<theme>/synthesizer.md` + `sections/<id>/curator.md`): unified report with 6 top-level tabs — **訊號** (signals: focus / sleeper / contrarian / predictions), **動手做** (ideation: general / work, split by `audience` tag), **上線** (shipped: trending / topic_discovery / dev_watch_taiwan / dev_watch_global), **脈動** (pulse: hn / lobsters / chinese_community / ai_bloggers), **市場** (market: ma / funding / policy / taiwan), **技術** (tech: vendor / models / benchmarks / aidaptiv). Every item carries an `audience` tag (`general` | `work` | `both`) for cross-tab filter chips. Items carry stable ids so signals/ideas `source_links` back to curated items — the merge step (Stage 4) validates these references. Spec: `docs/superpowers/specs/2026-05-22-ia-redesign-design.md` (IA) + `2026-05-24-pipeline-redesign-output-storage-themes-design.md` (output split / themes / storage).
- Legacy v1.x reports (pre-2026-05-22) used a different shape (`ideas[]`, flat `shipped[]`, `pulse.curated/hn/lobsters`, `dev_watch`, `signals[]`); templates route them to the legacy partial via `schema_version` check. v2.0 reports (2026-05-22 to 2026-05-24, pre-output-split) and v2.1 reports (post-split) share the same on-disk shape and render via the same v2 unified partial.

## Quality bar

- All active `data/*.json` artifacts validate against Zod schemas — staging metadata in `src/collect.js`, editorial in `scripts/synthesize.sh`, and the composed report in the merge + `scripts/analyze.sh` steps. Schema drift aborts the run before any commit.
- All JS/JSON formatted with Biome (`npm run lint` on every CI run).
- Vitest tests (schemas, condense, theme loader, merge, scope) run on `npm test` and in CI.
- Conventional commits encouraged.
- **The theme's synthesizer + quality prompts are the quality lever** (`themes/ai-builder/synthesizer.md` + `themes/ai-builder/quality.md`). They're **outcome-oriented, not mechanism-prescriptive**: instead of hard count/length rules, they describe the reader persona (AI engineer who builds), give positive paragraph examples of good vs slop voice, enumerate ~12 Chinese translation-smell patterns for structural anti-slop, and apply a "single slop test" (delete every sentence that, if removed, wouldn't make the reader lose a specific number / name / version / concrete claim). The prompt was calibrated against 4 external reviewers (tech editor / Chinese-language editor / strategy analyst / non-AI product manager) who independently flagged issues invisible to in-domain review (kebab-case slug leaks, unverifiable "first-ever" superlatives, internal contradictions, pattern-matching to overconfidence, audience split-personality). See [docs/architecture.md](./docs/architecture.md) for the design philosophy.
