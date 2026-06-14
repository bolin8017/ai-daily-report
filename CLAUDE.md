# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

An AI-powered daily creative tech brief for **AI engineers who build** (RAG / VLM / fine-tuning / agent / MCP). Every day, a Claude Code agent collects signals from GitHub Trending, GitHub topic search (freshness-first, ≤30-day-old repos), GitHub developer activity, Hacker News, Lobsters, Dev.to, Anthropic News, HuggingFace Daily Papers, and ~10 other RSS sources (Simon Willison, Karpathy, Gary Marcus, Google AI Blog, Phoronix, LWN, etc.), then synthesizes them into a deep analyst-style brief published to GitHub Pages.

The tone is **senior analyst briefing a busy CTO** — FT / Bloomberg / The Information / Stratechery voice — not corporate marketing. Mechanism over metaphor, specific over generic, builder-oriented action advice over decision-maker strategy talk. The audience is deliberately locked to builders (not PMs, not founders, not decision-makers); if a section drifts into "talk to your CTO about vendor strategy" territory, the prompt's Step 7 self-check catches it.

For the public-facing overview and quick start, see [README.md](./README.md). For design decisions and trade-offs, see [docs/architecture.md](./docs/architecture.md).

## Deployment mode

The pipeline is split into **four stages**, run under Hermes cron (07:00 Asia/Taipei) or local operator control; the active data contract is repo-local staging plus Hermes Wiki context, not repo-local memory.

- **Stage 1 — collect** (`src/collect.js`): pure Node.js — fetches sources in parallel, condenses each to ≤8500 tokens, builds the feeds snapshot, writes condensed data to `data/staging/`. **Does not commit** — staging is local-only; the feeds snapshot it builds is committed later by Stage 4 for the 11ty footer (see "Storage" below). The **native-RSS feed half is ingested from a self-hosted Miniflux** (fed by self-hosted RSSHub; see "Aggregator ingestion" below + `docker/aggregator/`), partitioned by `themes/<theme>/feeds.opml`: feeds listed there come from one Miniflux pull, everything else (HN/Lobsters, the RSSHub-only `dev-to-top`/`anthropic-news`, slow `sk-hynix-news`, and all structured sources — github-*, leaderboards, mops, hf-trending, arxiv) still fetches via its provider chain. If Miniflux is unconfigured (local dev without the stack), collect falls back to chain-fetching everything. GitHub topic search uses a widened net (floor 40 stars, 25 results/topic, 8 rotating topics/day). After recording the star snapshot, Stage 1 runs the **excellence funnel** (`src/lib/build-discoveries.js`) over all collected GitHub items and writes `data/staging/feeds-discoveries.json` (non-fatal if it fails). This is the sole input to the 新發現 (discoveries) tab: the Stage 2 discoveries curator applies the novelty bar to it, and Stage 4 merge re-attaches its deterministic signals (velocity / excellence / eng) by repo key.
- **Stage 2 — curate** (`scripts/curate.sh`): 4 parallel `claude -p --model claude-haiku-4-5` subprocesses (one per section: discoveries / pulse / market / tech). Each reads its staging slice, applies its prompt at `themes/<ACTIVE_THEME>/sections/<section>/curator.md`, writes validated JSON to `data/staging/curated/<section>.json`. Critical sections (discoveries, pulse) failure aborts; non-critical (market, tech) failure logs degraded. The `discoveries` curator (新發現) is a critical core curator: it applies the novelty bar to Stage 1's excellence-funnel output (`data/staging/feeds-discoveries.json`), emitting `{rising, dev_watch}` picks (merge re-attaches the deterministic funnel signals by repo key and ranks). The earlier optional `curate.catalog` stage + the 精選/上線 tabs were retired on the 2026-06-15 cutover; archived reports still carry `catalog`/`shipped` and render via the templates' legacy conditional.
- **Stage 2.5 — context** (`scripts/hermes/build-report-context.mjs`): builds a bounded `data/staging/report-context.md` from the local Hermes Wiki (`/home/bolin8017/Documents/Hermes/Wiki`) plus current run metadata. This is the only cross-day intelligence input for Stage 3.
- **Stage 3 — synthesize** (`scripts/synthesize.sh`): single `claude -p --model claude-sonnet-4-6` invocation. Reads curated/* + raw staging + `data/staging/report-context.md`, applies `themes/<ACTIVE_THEME>/synthesizer.md` + `quality.md`, and writes **only the editorial layer** to `data/staging/editorial.json` (lead / signals, `EditorialSchema 2.1-editorial`). It does **not** emit curated sub-groups and no longer reads or writes `data/memory.json` — the editorial/merge split is what fixed the 32K output-token cap on 2026-05-24.
- **Stage 4 — merge** (`scripts/merge-report.sh` → `src/lib/merge.js`): pure Node, no LLM, idempotent. Composes the final `data/reports/<date>.json` (ReportSchema 2.1) from `editorial.json` + `curated/*.json`. Referential integrity is **cured, not enforced by abort** (changed 2026-06-04): a `source_links` id that resolves to no curated item (after slug-tolerant prefix matching) is dropped and logged — the citing item still renders without that dead cross-tab anchor — rather than aborting the whole report. The synthesizer prompt is the primary defense (cite-or-empty, never invent an id); this deterministic drop is the backstop. Merge also re-attaches the discoveries funnel signals (via `buildDiscoveriesSection`) and appends the day's shown discoveries repo keys (rising + dev_watch) to `data/seen-repos.json` (the cross-day dedup ledger), which is committed to the `data` branch alongside the report.

`scripts/run.sh` drives the `src/pipeline` DAG sequencer (`src/pipeline/run.js`, which reads `stages.js` + `satisfied()`): Stage 2 → 2.5 → 3 → 3.5 → Stage 4, skipping already-satisfied stages on resume, then commits (reports + feeds snapshot; no memory commit). The earlier `FEATURE_NEW_PIPELINE=0` lens-based single-stage path has been removed; the v1.x reports it produced before 2026-05-22 still live on the `data` branch and render through the templates' legacy lens partial.

GitHub Actions deploys the 11ty site to Pages on a push to `main` (code/site changes) or on a `repository_dispatch` (type `data-committed`) the Hermes cron production pipeline fires after committing the day's report to the `data` branch (`data`-branch pushes can't trigger workflows themselves).

## Branch layout

Two long-lived branches with distinct roles:

- **`main`**: human-authored source — code, templates, CI, scripts, config. Bot never pushes here.
- **`data`** (orphan branch, no shared history with `main`): bot-produced public artifacts — `data/reports/` (rolling 60-day hot window), `data/feeds-snapshot.json` (small, overwritten each run — the 11ty footer reads it at build time), `data/seen-repos.json` (small, append-only cross-day dedup ledger for the 新發現 discoveries section — committed each run; mechanical dedup state, distinct from the retired `data/memory.json` LLM blob), and `data/star-history.json` (append-only per-repo daily star/fork snapshot ledger, 30-day rolling retention — the velocity backbone for the 新發現 tab, committed each run alongside the report). `data/memory.json` is retired from the active pipeline; cross-day intelligence lives in the local Hermes Wiki and is projected into `data/staging/report-context.md` per run. Only the merge + commit step (Stage 4 / `run.sh`'s commit tail) lands public artifacts here. Staging is not committed; older reports archive to GitHub Releases (see "Storage").

`src/lib/commit.js` builds commits using git plumbing (`read-tree` into an isolated `GIT_INDEX_FILE`, `write-tree`, `commit-tree`, then `push commit:refs/heads/data`) — never checks out the data branch, never touches main's working tree or index. It also has a `--remove` mode (used by the monthly archive job to delete archived reports from the data branch). In CI the build job checks out `main` for code, then `git fetch` + `git checkout refs/remotes/origin/data -- data/` to pull in the recent reports, then hydrates older months from Releases before running 11ty.

**Production runtime**: production is Hermes cron at 07:00 Asia/Taipei, delivered back to Telegram on failure or notable completion. A second monthly Hermes cron job (1st of month, 05:00 Asia/Taipei) runs `scripts/archive-month.sh` for hot/cold report storage.

**Why stages split from one process**: the original `pipeline.js` called `claude -p` as a subprocess from Node.js, which hung indefinitely due to FD table / SSE keepalive interactions. Splitting the LLM stages into bash-invoked `claude -p` calls (no Node parent) avoids the hang and gives the agent native tool access (Read/Write) instead of piping 50KB+ through the prompt body. The later editorial/merge split (Stage 3 → Stage 4) additionally keeps LLM output small (~3-5K tokens) so it never hits the output-token cap.

## How to Run

| Command | What it does |
|---|---|
| `npm start` | Local dev: runs `scripts/run.sh` → Stage 1 only (fetch + snapshot + condense, no push, no LLM). |
| `bash scripts/run.sh --full` | Stage 1 → 2 → 3 → 4 (requires host Claude Code login). |
| `bash scripts/run.sh --skip-push` | Stages 1–4; writes outputs to local `data/` but skips commit/push. Inspect the result by reading the files directly (e.g. `jq . data/reports/$(date +%F).json`). |
| `bash scripts/run.sh --analyze` | Stages 2–4 only (assumes `data/staging/` is populated — run Stage 1 first, or hydrate from `data` branch: `git fetch origin data && git checkout origin/data -- data/`). |
| `npm run collect` / `npm run collect:dry` | Direct invocation of `node src/collect.js` with or without `--skip-push`. |
| `npm run analyze` | Alias for `bash scripts/run.sh --analyze` (Stages 2–4 via the sequencer; **no push** by default — use `--full` or clear `SKIP_PUSH` to publish). |
| `node src/fetchers/feeds.js` | Any single fetcher can still be run standalone; all fetchers are dual-mode (importable + CLI). |
| `node src/lib/condense.js` | Standalone mode reads `tmp/*.json`, writes `tmp/*-condensed.json` — useful for debugging the condense budget. |
| `bash scripts/merge-report.sh [DATE]` | Re-run Stage 4 alone against existing `editorial.json` + `curated/*` (debug the merge / dangling-link check without re-invoking the LLM). |
| `bash scripts/run.sh --recover-from <stage>` | Operator escape hatch: re-run `<stage>` + everything downstream, then publish (honors `SKIP_PUSH=1` for a no-push rehearsal). Auto-recovery for transient failures is automatic inside `--full` via the sequencer's `--auto-recover`; this is the manual equivalent. |
| `node src/ops/production-run.js run --state-dir D [--wiki-root W] [--skip-push] [--recover-from STAGE]` | Production runner (Hermes-facing): drives `run.sh --full` with auto-recovery, then validates / verifies the remote report / dispatches the Pages build, and writes structured state (`latest.json`) under `D`. `status --json` / `monitor` read that state. The Hermes cron wrapper supplies flock + detach + git sync around it. `--recover-from STAGE` instead drives `run.sh --recover-from STAGE` — resume from STAGE reusing already-finished upstream stages (no re-collect / no re-spent LLM), then run the same publish tail. The cheap path to re-publish after fixing a deterministic stage (e.g. `merge`) without re-running collect/curate/synthesize. |
| `ACTIVE_THEME=<name> bash scripts/run.sh --full` | Run the pipeline against an alternate theme directory. |
| `npm run build` | Rebuild the static site. Requires `data/` populated locally — either run Stage 1 first, or `git fetch origin data && git checkout origin/data -- data/`. |
| `npm run serve` | 11ty dev server with live reload. |
| `npm test` | Vitest unit tests for schemas + condense + theme loader + merge. |
| `npm run lint` / `npm run format` | Biome check / format --write. |
| `npm run check:sources` | Verify `docs/data-sources.md` is in sync with `themes/<ACTIVE_THEME>/sources.yaml`. |
| `npm run validate:report` | Validate the newest report in `data/reports/` against the composed `ReportSchema`. |

## Project Structure

```
.
├── src/
│   ├── collect.js                # Stage 1 entry — fetch → condense → snapshot → write staging (no commit)
│   ├── fetchers/                 # Provider-chain fetchers (dual-mode: importable + standalone CLI)
│   │   ├── providers/            # One file per provider; theme-aware ones read themes/<theme>/sources.yaml
│   │   ├── run-all.js            # Parallel chain runner — used by collect.js
│   │   ├── miniflux.js           # Stage 1 native-RSS pull from self-hosted Miniflux (entry.feed.title → source id)
│   │   └── _dispatch.js          # Shared helper that detects CLI mode and emits JSON
│   ├── curators/                 # Stage 2 curator orchestrators (_base.js resolves theme curator paths)
│   ├── pipeline/                 # Orchestration: stages.js (DAG registry + recovery policy),
│   │                             #   satisfied.js (resume check), run.js (sequencer:
│   │                             #   resume/barrier/batches + bounded --auto-recover)
│   ├── ops/                      # Production runner: production-run.js (run/status/monitor —
│   │                             #   synchronous Node the Hermes bash wrapper calls), stage-results.js
│   ├── schemas/                  # Zod schemas (single source of truth)
│   │   ├── config.js             # Minimal post-cutover config (providers + report only)
│   │   ├── editorial.js          # EditorialSchema (Stage 3 output: lead/signals)
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
│       ├── feeds-opml.js         # Parse/load themes/<theme>/feeds.opml (the Miniflux feed list) + url normalize
│       ├── miniflux-client.js    # Miniflux base url + auth headers (API token or HTTP basic)
│       ├── miniflux-sync.js      # Pure planMinifluxSync() reconcile planner (used by scripts/miniflux-sync.mjs)
│       ├── commit.js             # git plumbing add/commit/push + --remove mode (archive job)
│       └── validate.js           # CLI schema validator
├── themes/                       # Swappable persona/voice/source/section bundles (see "Themes")
│   └── ai-builder/               # Default theme — theme.yaml, sources.yaml, ui-strings.yaml,
│                                 #   synthesizer.md, quality.md, sections/<id>/{manifest,curator,schema,partial}
├── scripts/
│   ├── run.sh                    # Pipeline entry: Stage 1 then drives the sequencer; --full publishes
│   ├── curate.sh                 # Stage 2 — 4 parallel claude -p (Haiku); accepts a section arg to re-run one
│   ├── synthesize.sh             # Stage 2.5/3 — build report-context, then single claude -p (Sonnet) → editorial.json
│   ├── merge-report.sh           # Stage 4 — mechanical compose editorial + curated → report.json
│   ├── archive-month.sh          # Package reports >HOT_DAYS → GitHub Releases (curl + REST API)
│   ├── hydrate-archive.sh        # CI build helper — pull last HYDRATE_MONTHS from Releases
│   ├── gen-feeds-opml.mjs        # Generate themes/<theme>/feeds.opml from the registry (Miniflux scope)
│   ├── miniflux-sync.mjs         # Provision feeds.opml into self-hosted Miniflux (idempotent; --reset)
│   └── watchdog.sh               # /proc/$PID/io + CPU liveness monitor for claude -p
├── site/                         # 11ty source templates (Nunjucks)
│   ├── _includes/                # base.njk, report-body.njk (schema-version dispatcher), v2/*, lens/* (legacy)
│   ├── assets/                   # style.css + app.js (tab + filter logic)
│   ├── feed.njk                  # RSS feed template
│   ├── index.njk                 # Main page (schema-version dispatcher → v2/unified.njk)
│   └── archive.njk               # Archive pages via 11ty pagination
├── docker/aggregator/            # Self-hosted Miniflux + RSSHub + Postgres stack (Stage 1 native-RSS ingestion); .env gitignored
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
- **Community feeds**: native-RSS sources (Simon Willison, Karpathy, Gary Marcus, Google AI Blog, Phoronix, LWN, Chinese-community + Taiwan-media, etc.) are ingested via **self-hosted Miniflux** (see "Aggregator ingestion"). Hacker News (enriched via Algolia for scores/comments), Lobsters, Dev.to, Anthropic News, and HuggingFace Daily Papers stay on provider chains (score-bearing or RSSHub-only), the RSSHub ones now via the self-hosted RSSHub.
- **GitHub Trending** (`github-trending-html.js`): scrapes `github.com/trending`, enriches each repo via Octokit.
- **GitHub topic search** (`github-search-api.js`): freshness-first `topic:X stars:>100 created:>30daysAgo` + README excerpt; one of the GitHub candidate sources feeding the **新發現** excellence funnel. Topics come from `themes/<theme>/sources.yaml → github_topics` (a `tier.core` always-on set + `tier.rotating` set sampled per day).
- **GitHub developer watch** (`github-developers-api.js`): top global + per-region (Taiwan) developers' newest repos within a 72h window → feeds the **新發現** funnel's `dev_watch` group (the funnel routes `source: 'github-developers'` items there).
- **Leaderboards / MOPS / HF trending / arXiv**: structured fetchers written raw to staging (no condense step).

## Schemas (Zod, single source of truth)

All data shapes are validated against Zod schemas in `src/schemas/`:

| Schema | Validates | Used at |
|---|---|---|
| `ConfigSchema` | `config.json` (now just `providers` + `report`) | Startup, in `src/lib/config.js` |
| `StagingMetadataSchema` | `data/staging/metadata.json` | `src/collect.js` before writing (Stage 1 → Stage 2 contract) |
| section `schema.js` (per theme section) | each `data/staging/curated/<section>.json` | Stage 2 curators after writing |
| `EditorialSchema` | `data/staging/editorial.json` | `scripts/synthesize.sh` after Stage 3 |
| `ReportSchema` / `buildReportSchema()` | `data/reports/YYYY-MM-DD.json` | Stage 4 merge + `scripts/run.sh` validate |

`buildReportSchema(theme)` composes the report schema at runtime from the active theme's section `schema.js` modules + the static editorial blocks (lead / signals), so adding a section never requires editing `report.js`. `resolveReportSchema()` returns it.

**If validation fails, the pipeline aborts.** This catches schema drift between LLM output and template expectations early — before broken data reaches `_site/`.

Note: `ReportSchema` uses `.passthrough()` at the top level and makes most sub-fields optional. This is intentional: the LLM output shape drifts slightly. A strict schema would reject cosmetically varied but semantically valid reports. `schema_version` accepts both `2` (legacy, pre-2026-05-24) and `2.1` (post-cutover editorial+merge); both render via the same v2 unified partial.

## Output

- **Static HTML** built in CI by 11ty, deployed to GitHub Pages via `actions/deploy-pages@v4` (OIDC artifact, not a `gh-pages` branch).
- **Live URL:** https://bolin8017.github.io/ai-daily-report
- **Archive:** recent `data/reports/YYYY-MM-DD.json` live on the `data` branch (60-day hot window); older months archive to GitHub Releases and are hydrated back at build time. 11ty pagination generates `_site/archive/YYYY-MM-DD.html`. Footer shows last 7; all reports kept permanently (hot on branch, cold in Releases).
- **RSS feed:** `_site/feed.xml`

## State Management

Public artifacts are hydrated into the working tree by `.github/workflows/deploy.yml` on each CI build. Cross-day intelligence is intentionally local-only in Hermes Wiki.

- `/home/bolin8017/Documents/Hermes/Wiki` — local Hermes Wiki intelligence store. It is not committed to GitHub and is the durable home for themes, arcs, and monitoring notes.
- `data/staging/report-context.md` — bounded per-run context generated from Hermes Wiki for Stage 3. It is staging-only and not committed.
- `data/reports/YYYY-MM-DD.json` (on `data` branch, 60-day hot window) — daily reports composed by Stage 4. 11ty reads this directory to generate archive pages.
- `data/staging/` — **ephemeral** (not committed). Holds Stage 1 condensed files + `metadata.json` + Stage 2 `curated/*` + Stage 2.5 `report-context.md` + Stage 3 `editorial.json`.
- `data/feeds-snapshot.json` — rebuilt each Stage 1 run and **committed by Stage 4** (small, overwritten daily). The 11ty footer source-status pills + community feed lists read it at build time, and CI builds from the `data` branch, so it must be committed or the footer renders a stale snapshot.
- `data/seen-repos.json` — append-only cross-day dedup ledger for the 新發現 discoveries section. **Committed by Stage 4** each run alongside the report. Contains the canonical repo key of every repo shown in past discoveries items; the excellence funnel (`src/lib/build-discoveries.js`) excludes repos already in this set before building the candidate pool, so the curator only ever sees unseen repos, and Stage 4 (merge) appends the day's shown picks (rising + dev_watch) back to the ledger. Mechanical dedup state — distinct from the retired `data/memory.json` LLM intelligence blob.
- `data/star-history.json` — append-only per-repo daily star/fork snapshot ledger (the velocity backbone for the 新發現 tab). **Committed by Stage 4** each run alongside the report; **hydrated in CI** from the `data` branch. 30-day rolling retention. Written by Stage 1 (`src/lib/star-history.js`) from numbers already in the fetched payloads — zero extra GitHub API.
- `data/staging/feeds-discoveries.json` — **ephemeral** (staging, not committed). Stage 1's excellence-funnel output for the 新發現 tab: novelty-eligible GitHub candidates scored by velocity + engineering signals + external validation, plus a cold-start watchlist. Built by `src/lib/build-discoveries.js`; consumed by the Stage 2 `discoveries` curator (novelty bar) and Stage 4 merge (`buildDiscoveriesSection` re-attaches its signals by repo key and ranks).
- **Cold archive** — reports older than `HOT_DAYS` (60) live in GitHub Releases as `archive-YYYY-MM` tags (`reports-YYYY-MM.tar.gz` + sha256), produced by a monthly Hermes cron job (1st of month, 05:00 Asia/Taipei) that runs `scripts/archive-month.sh`.

`data/memory.json` and its `MemorySchema` have been removed from the codebase; cross-day intelligence now lives only in the local Hermes Wiki, projected per run into `data/staging/report-context.md`. The file is already absent from the `data` branch.

## Environment

Required:
- `GITHUB_TOKEN` — PAT with `Contents: read/write` scope. Used by Octokit fetchers AND as the commit/push credential in the production pipeline (see `src/lib/commit.js`, which injects the token as an `http.extraheader` via Git 2.31+'s `GIT_CONFIG_COUNT` env vars — the same mechanism `actions/checkout` uses — so the token never touches `.git/config` or the remote URL). Under Hermes cron it comes from the production environment; locally, loaded from `.env`.
- **Claude Code subscription** — `claude -p` in Stage 2/3 draws from the Max subscription (not API billing). Credentials live in `~/.claude` on the production host.
- **Aggregator stack (self-hosted Miniflux + RSSHub)** — required in production after the 2026-06-06 cutover. Run `docker compose -f docker/aggregator/docker-compose.yml up -d` (RSSHub + Miniflux + Postgres, host networking, all bound to `127.0.0.1`); provision feeds from `themes/<theme>/feeds.opml` with `node scripts/miniflux-sync.mjs`. Stage 1 reads the native-RSS feed half from Miniflux. Needs `MINIFLUX_URL` + (`MINIFLUX_USERNAME` + `MINIFLUX_PASSWORD`, **or** `MINIFLUX_TOKEN`). If unset, collect falls back to chain-fetching everything. See [docs/architecture.md](./docs/architecture.md) → "Fetcher strategy / Native-RSS ingestion".
- **RSSHub** — `themes/<ACTIVE_THEME>/sources.yaml → rsshub_urls` now points at the self-hosted instance (`http://localhost:1200`); the public instances were retired in the cutover. Only the RSSHub-dependent chains (`dev-to-top`, `anthropic-news`, `hackernews`, `hf-daily-papers`) use it, falling through to jina/firecrawl on failure. The native-RSS feeds no longer go through this chain — they are ingested via Miniflux (see the aggregator bullet above).

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
| `.github/workflows/deploy.yml` | (a) push to `main` matching the deploy paths (code/site/workflow changes), OR (b) pull_request matching the wider validation paths (`src/**`, `tests/**`, `scripts/**`, configs included), OR (c) `repository_dispatch` (type `data-committed`) that the Hermes cron production pipeline POSTs at the end of each daily run — right after the report is pushed to `data` — OR (d) manual `workflow_dispatch`. Note: pushes to the `data` branch **do not** fire the workflow — the orphan `data` branch has no `.github/workflows/` tree, which is why the production pipeline's `repository_dispatch` is the primary auto-deploy path for bot reports (it replaced a `schedule: '0 0 * * *'` poll that GitHub drifted by hours, lagging the published site by most of a morning). | `build` job runs always: checkout `main` → hydrate recent `data/` from `data` branch → **hydrate cold archive from Releases** (`scripts/hydrate-archive.sh`, best-effort) → lint + tests + schema validation + 11ty build. `deploy` job runs on every event except `pull_request`: `upload-pages-artifact` → `deploy-pages` OIDC. PR validation ends after `build`. Concurrency group is per-PR (cancel-in-progress) for PRs and shared `pages` for everything else. |

GitHub Pages source: **GitHub Actions** (`build_type: workflow`). No legacy `gh-pages` branch.

**Node 24 opt-in**: the workflow sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` at the top level so `actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact`, and `actions/deploy-pages` all run on Node 24. This is ahead of GitHub's 2026-06-02 forced migration (Node 20 removal from runners on 2026-09-16). Once all official action versions default to Node 24 (expected by June), the env var can be removed.

## Notes

- **Scheduling**: production runs under Hermes cron at 07:00 Asia/Taipei, with Telegram reporting for failures/notable completion. A separate monthly Hermes cron job (1st of month, 05:00 Asia/Taipei) runs `scripts/archive-month.sh` for hot/cold storage. The repo now owns the production runner (`src/ops/production-run.js`); how Hermes wraps it (thin start/monitor scripts, state contract, migration steps) was documented in [docs/archive/hermes-production-runner.md](./docs/archive/hermes-production-runner.md) (now archived — historical migration guide; the runner itself is `src/ops/production-run.js`).
- **Schema-first**: when changing report sections, update the section's `themes/<theme>/sections/<id>/schema.js` first (the dynamic composer picks it up), then the curator prompt, then the section `partial.njk`. This catches mismatches at validate time.
- **Git push auth** — `src/lib/commit.js` injects `$GITHUB_TOKEN` as an `http.extraheader` via `GIT_CONFIG_COUNT` env vars (Git 2.31+). The token never touches `.git/config` or the remote URL, so a mid-pipeline crash can't leave the token persisted on disk. This is the same mechanism GitHub's own `actions/checkout` uses. The archive job's Releases uploads use plain `curl` with the same token.
- **External RSSHub dependency** — `themes/<theme>/sources.yaml → rsshub_urls` now points at the self-hosted RSSHub (`http://localhost:1200`, in `docker/aggregator/`); public instances were retired in the 2026-06-06 cutover. The native-RSS feeds are ingested via Miniflux now, so only the RSSHub-dependent chains (`dev-to-top`, `anthropic-news`, `hackernews`, `hf-daily-papers`) use this, and they fall through to jina/firecrawl on failure. `run-all.js` tolerates a fraction of sources failing at the chain level. `RSSHUB_URL=...` still force-overrides to a single instance for debugging.
- **Provider-chain fetchers** — each source declares an ordered provider chain; `src/fetchers/providers/*` files register providers and `run-chain.js` walks the chain falling through on failure. Theme-aware providers (`rsshub.js`, `github-search-api.js`, `github-developers-api.js`) read their config from `themes/<theme>/sources.yaml` via `getThemeSources()`.
- Report sections (schema 2.1 unified, prompts in `themes/<theme>/synthesizer.md` + `sections/<id>/curator.md`): unified report with 5 top-level tabs — **訊號** (signals: focus / sleeper / contrarian / predictions), **新發現** (discoveries: rising / dev_watch — the excellence-funnel rising-stars tab, deduped across days via `data/seen-repos.json`), **脈動** (pulse: hn / lobsters / chinese_community / ai_bloggers), **市場** (market: ma / funding / policy / taiwan), **技術** (tech: vendor / models / benchmarks / aidaptiv). 新發現 replaced the retired 精選 (catalog) + 上線 (shipped) tabs on the 2026-06-15 cutover. Every item carries an `audience` tag (`general` | `work` | `both`) for cross-tab filter chips. Items carry stable ids so signals/ideas `source_links` back to curated items — the merge step (Stage 4) validates these references. Spec: `docs/superpowers/specs/2026-05-22-ia-redesign-design.md` (IA) + `2026-05-24-pipeline-redesign-output-storage-themes-design.md` (output split / themes / storage).
- Legacy v1.x reports (pre-2026-05-22) used a different shape (`ideas[]`, flat `shipped[]`, `pulse.curated/hn/lobsters`, `dev_watch`, `signals[]`); templates route them to the legacy partial via `schema_version` check. v2.0 reports (2026-05-22 to 2026-05-24, pre-output-split) and v2.1 reports (post-split) share the same on-disk shape and render via the same v2 unified partial. v2.1 reports from before the 2026-06-15 cutover carry `catalog`/`shipped` sections instead of `discoveries`; `unified.njk` conditions on `report.discoveries` to render either the live 新發現 tab or the legacy 精選+上線 tabs, and the static `ReportSchema` explicitly declares `shipped` (`ShippedSection`); `catalog` has no explicit field there but passes through via the top-level `.passthrough()` — `CatalogItem` in `items.js` still validates individual catalog items used by legacy templates.

## Quality bar

- All active `data/*.json` artifacts validate against Zod schemas — staging metadata in `src/collect.js`, editorial in `scripts/synthesize.sh`, and the composed report in the merge step. Schema drift aborts the run before any commit.
- All JS/JSON formatted with Biome (`npm run lint` on every CI run).
- Vitest tests (schemas, condense, theme loader, merge, scope) run on `npm test` and in CI.
- Conventional commits encouraged.
- **The theme's synthesizer + quality prompts are the quality lever** (`themes/ai-builder/synthesizer.md` + `themes/ai-builder/quality.md`). They're **outcome-oriented, not mechanism-prescriptive**: instead of hard count/length rules, they describe the reader persona (AI engineer who builds), give positive paragraph examples of good vs slop voice, enumerate ~12 Chinese translation-smell patterns for structural anti-slop, and apply a "single slop test" (delete every sentence that, if removed, wouldn't make the reader lose a specific number / name / version / concrete claim). The prompt was calibrated against 4 external reviewers (tech editor / Chinese-language editor / strategy analyst / non-AI product manager) who independently flagged issues invisible to in-domain review (kebab-case slug leaks, unverifiable "first-ever" superlatives, internal contradictions, pattern-matching to overconfidence, audience split-personality). See [docs/architecture.md](./docs/architecture.md) for the design philosophy.
