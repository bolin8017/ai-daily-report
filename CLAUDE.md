# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

An AI-powered daily creative tech brief for **AI engineers who build** (RAG / VLM / fine-tuning / agent / MCP). Every day, a Claude Code agent collects signals from GitHub Trending, GitHub topic search (freshness-first, ≤30-day-old repos), GitHub developer activity, Hacker News, Lobsters, Dev.to, Anthropic News, HuggingFace Daily Papers, and ~10 other RSS sources (Simon Willison, Karpathy, Gary Marcus, Google AI Blog, Phoronix, LWN, etc.), then synthesizes them into a deep analyst-style brief published to GitHub Pages.

The tone is **senior analyst briefing a busy CTO** — FT / Bloomberg / The Information / Stratechery voice — not corporate marketing. Mechanism over metaphor, specific over generic, builder-oriented action advice over decision-maker strategy talk. The audience is deliberately locked to builders (not PMs, not founders, not decision-makers); if a section drifts into "talk to your CTO about vendor strategy" territory, the prompt's Step 7 self-check catches it.

For the public-facing overview and quick start, see [README.md](./README.md). For design decisions and trade-offs, see [docs/architecture.md](./docs/architecture.md).

## Deployment mode

The pipeline is split into **two independent stages**, both running inside a Docker container on the VM:

- **Stage 1** (`src/collect.js`): pure Node.js — fetches 4 sources in parallel, condenses each to ≤8500 tokens, builds the feeds snapshot, writes condensed data to `data/staging/`, then commits it to the `data` branch via plumbing in `src/lib/commit.js`.
- **Stage 2** (`scripts/analyze.sh`): invokes `claude -p --allowedTools Read Write Grep Glob` — the agent reads staged data via Read tool, analyzes per `.claude/agents/daily-report.md`, writes report + memory via Write tool. The script then validates against Zod schemas and commits to the `data` branch (again via `src/lib/commit.js`). Bash is intentionally excluded from the allowlist to shrink the blast radius of any prompt-injection in fetched content.

GitHub Actions picks up either push (main for code, data for daily artifacts) and deploys the 11ty site to Pages.

## Branch layout

Two long-lived branches with distinct roles:

- **`main`**: human-authored source — code, templates, CI, scripts, config. Bot never pushes here.
- **`data`** (orphan branch, no shared history with `main`): bot-produced artifacts — `data/reports/`, `data/memory.json`, `data/feeds-snapshot.json`, `data/staging/`. Every Stage 1 / Stage 2 commit lands here.

`src/lib/commit.js` builds commits using git plumbing (`read-tree` into an isolated `GIT_INDEX_FILE`, `write-tree`, `commit-tree`, then `push commit:refs/heads/data`) — never checks out the data branch, never touches main's working tree or index. In CI the build job checks out `main` for code, then `git fetch` + `git checkout refs/remotes/origin/data -- data/` to pull in the report archive before running 11ty.

**Production runtime**: a Google Cloud e2-micro VM (always-free tier, us-west1) runs both stages daily at 04:00 Asia/Taipei via **systemd timer** → `scripts/cron-run.sh` → `docker run ai-daily-report:latest`. The Docker image contains Node 22, git, and the Claude Code CLI; the repo is cloned into a persistent Docker volume at `/workspace` and refreshed via `git pull` on each run.

**Why two stages instead of one process**: the original `pipeline.js` called `claude -p` as a subprocess from Node.js, which hung indefinitely due to FD table / SSE keepalive interactions. The two-stage split lets Stage 2 call `claude -p` directly from bash (no Node parent), avoiding the hang. It also gives the agent native tool access (Read/Write) instead of piping 50KB+ of data through the prompt body.

**VM environment requirements** (managed by `scripts/setup-vm.sh`):

| Setting | Value | Why |
|---|---|---|
| **Swap** | 2GB file at `/swapfile` | e2-micro has limited RAM. LLM synthesis peaks need headroom to avoid OOM. |
| **Docker image** | `ai-daily-report:latest`, built locally from `Dockerfile` | Contains Node 22 + git + `@anthropic-ai/claude-code` CLI. No project code baked in — code flows via `git pull` on each run. |
| **Docker volume** | `ai-daily-report-workspace` | Persists the cloned repo + `node_modules` between runs so cold starts stay <10s. |
| **Claude auth** | Bind mount `~/.claude` from host → `/home/pipeline/.claude` in container (read-write) | One-time interactive `claude /login` inside the container creates credentials that persist across timer invocations. Mount must be writable so the CLI can refresh the OAuth token before expiry — a read-only mount deadlocks the pipeline (see commit `faea48e` "fix(docker): let claude cli refresh oauth token" for the failure mode). |
| **Secrets** | `~/.ai-daily-report.env` with `GITHUB_TOKEN=ghp_...` | Loaded by `scripts/cron-run.sh`, injected into container via `-e GITHUB_TOKEN`. |
| **Memory limits** | `docker run --memory=600m --memory-swap=1g` | Caps the pipeline so an OOM never kills the host's other services. |
| **Scheduling** | systemd timer (`systemd/ai-daily-report.timer`) | `Persistent=true` catches up after VM reboots; `OnFailure=` triggers alert on crash; logs go to `journalctl -u ai-daily-report`. |

## How to Run

| Command | What it does |
|---|---|
| `npm start` | Local dev: runs `scripts/run.sh` → Stage 1 only (fetch + snapshot + condense, no push, no LLM). |
| `bash scripts/run.sh --full` | Stage 1 + Stage 2 (requires host Claude Code login). |
| `bash scripts/run.sh --skip-push` | Stage 1 + Stage 2; writes outputs to local `data/` but skips both commit and push. Inspect the result by reading the files directly (e.g. `jq . data/reports/$(date +%F).json`). |
| `bash scripts/run.sh --analyze` | Stage 2 only (assumes `data/staging/` is populated — run Stage 1 first, or hydrate from `data` branch: `git fetch origin data && git checkout origin/data -- data/`). |
| `npm run collect` / `npm run collect:dry` | Direct invocation of `node src/collect.js` with or without `--skip-push`. |
| `npm run analyze` | Direct invocation of `bash scripts/analyze.sh`. |
| `node src/fetchers/feeds.js` | Any single fetcher can still be run standalone; all 4 fetchers are dual-mode (importable + CLI). |
| `node src/lib/condense.js` | Standalone mode reads `tmp/*.json`, writes `tmp/*-condensed.json` — useful for debugging the condense budget. |
| `npm run build` | Rebuild the static site. Requires `data/` populated locally — either run Stage 1 first, or `git fetch origin data && git checkout origin/data -- data/`. |
| `npm run serve` | 11ty dev server with live reload. |
| `npm test` | Vitest unit tests for schemas + condense. |
| `npm run lint` / `npm run format` | Biome check / format --write. |
| `npm run validate:report` | Validate the newest report in `data/reports/` against `ReportSchema`. |

**VM operations** (on the production VM):
- `bash scripts/setup-vm.sh` — one-time install (swap + Docker + systemd timer + image build). Idempotent.
- `sudo systemctl start ai-daily-report.service` — one-off manual run.
- `journalctl -u ai-daily-report --since today` — view latest run logs.
- `systemctl list-timers ai-daily-report.timer` — check next scheduled run.

## Project Structure

```
.
├── src/
│   ├── collect.js                # Stage 1 entry — fetch → condense → snapshot → write staging → commit
│   ├── fetchers/                 # All dual-mode (importable + standalone CLI)
│   │   ├── _dispatch.js          # Shared helper that detects CLI mode and emits JSON
│   │   ├── all.js                # Parallel runner — used by collect.js
│   │   ├── feeds.js              # Unified RSSHub + RSS + JSON API fetcher
│   │   ├── github-trending.js    # cheerio + Octokit GitHub trending scraper
│   │   ├── github-search.js     # GitHub Search API by topic (freshness-first)
│   │   └── github-developers.js  # Top GitHub developers' newest repos (global + regional)
│   ├── schemas/                  # Zod schemas (single source of truth)
│   │   ├── config.js
│   │   ├── feed-item.js
│   │   ├── memory.js
│   │   ├── report.js
│   │   └── staging.js            # Stage 1 → Stage 2 contract (metadata shape)
│   └── lib/
│       ├── config.js             # Validated config singleton (ConfigSchema.parse at import)
│       ├── github.js             # Shared Octokit factory + getReadmeExcerpt helper
│       ├── text-utils.js         # stripControlChars — sanitize README excerpts
│       ├── validate.js           # CLI schema validator
│       ├── snapshot.js           # Committed feeds-snapshot.json builder (dual-mode)
│       ├── condense.js           # Per-source ≤8500-token condenser (dual-mode)
│       └── commit.js             # git add/commit/push with GITHUB_TOKEN-based push auth
├── scripts/
│   ├── analyze.sh                # Stage 2 — assemble prompt → claude -p → validate → commit
│   ├── run.sh                    # Local dev wrapper (default: Stage 1 only, --full for both)
│   ├── cron-run.sh               # Docker invocation — used by systemd service
│   ├── docker-entrypoint.sh      # Inside-container entry: git pull + npm ci + collect/analyze/both
│   └── setup-vm.sh               # One-time VM setup: swap + Docker + systemd timer + OAuth
├── systemd/                      # systemd units (installed by setup-vm.sh)
│   ├── ai-daily-report.service   # Service: runs cron-run.sh with timeout + OnFailure
│   ├── ai-daily-report.timer     # Timer: daily 04:00 Asia/Taipei, Persistent=true
│   └── ai-daily-report-notify@.service  # Failure alert (optional webhook)
├── Dockerfile                    # node:22-slim + git + tini + @anthropic-ai/claude-code (no project code)
├── .dockerignore
├── site/                         # 11ty source templates (Nunjucks)
│   ├── _includes/                # base.njk, report-body.njk, idea-card.njk, shipped-item.njk
│   ├── assets/                   # style.css + app.js (tab + filter logic)
│   ├── feed.njk                  # RSS feed template
│   ├── index.njk                 # Main page (includes report-body.njk)
│   └── archive.njk              # Archive pages via 11ty pagination
├── tests/
│   └── schemas.test.js           # Vitest smoke tests for all Zod schemas (including staging contract)
├── data/                         # .gitignored on main; all files live on the `data` branch
│   ├── reports/                  # Daily reports (YYYY-MM-DD.json)
│   ├── staging/                  # Stage 1 output consumed by Stage 2 (condensed data + metadata)
│   ├── memory.json               # v2 cross-day state
│   └── feeds-snapshot.json       # Condensed snapshot for 11ty templates
├── docs/                         # Project documentation (architecture, contributing)
├── _site/                        # 11ty build output (gitignored — built in CI)
├── .github/workflows/deploy.yml  # CI: build + deploy to GitHub Pages via OIDC
├── .claude/
│   ├── agents/daily-report.md    # Agent prompt (piped to claude -p by analyze.sh)
│   └── daily-report-quality.md   # Voice / slop rules (concatenated after agent prompt)
├── biome.json                    # Biome lint + format config
└── eleventy.config.js            # 11ty build config (ESM)
```

## Data Sources

### `src/fetchers/feeds.js` (RSSHub + native APIs)
Via RSSHub (public instances tried in order: `https://rsshub.pseudoyu.com` → `https://rsshub.rssforever.com` on any per-request failure):
- **Hacker News** — front page + Show HN, enriched with Algolia API for scores/comments
- **Dev.to** — top articles of the week
- **Anthropic News**, **HuggingFace Daily Papers** — RSSHub routes

Via native JSON API:
- **Lobsters** — `/hottest.json` (scores, comments, tags)

Via native RSS:
- **SegmentFault**, **OSChina**, **Changelog**, **Simon Willison**, **Gary Marcus**, **Karpathy**, **Google AI Blog**, **Phoronix**, **LWN**

### `src/fetchers/github-trending.js`
Scrapes `github.com/trending` with **cheerio** (replaces brittle regex), enriches each repo via **Octokit**.

### `src/fetchers/github-search.js`
**Freshness-first** topic search. Query is `topic:X stars:>100 created:>30daysAgo` + README excerpt enrichment per result. The original `pushed:>yesterday` query was replaced because in 2026 GitHub every popular repo has nightly CI commits matching "pushed yesterday" — that returned the same long-lived heavyweights every day (langchain / ragflow / ShareX), not genuinely new repos. The current query surfaces 30-day-old topic-matched items that haven't hit HN or GitHub Trending yet; these feed the **discovery picks** slot inside `shipped` (agent prompt Step 6 requires 3–5 discovery picks per report). Topics are config-driven (`config.json → sources.github_topics.topics`): `rag`, `llm`, `agent`, `mcp`, `vlm`, `ocr`, `vector-database`, `fine-tuning`, `web-scraping`.

### `src/fetchers/github-developers.js`
Top developers (global top N + per-region top M, configurable via `config.json → sources.github_developers`) and their newest repos within a 72h window. Feeds `dev_watch` (Taiwan + Global). Uses Octokit with its bundled throttling + retry plugins; batches README enrichment 5 at a time to stay under secondary rate limits.

## Schemas (Zod, single source of truth)

All data shapes are validated against Zod schemas in `src/schemas/`:

| Schema | Validates | Used at |
|---|---|---|
| `ConfigSchema` | `config.json` | Startup (fetchers read config directly) |
| `FetchOutputSchema` | per-fetcher envelope | Not enforced in-process; available for debugging standalone fetcher output |
| `StagingMetadataSchema` | `data/staging/metadata.json` | `src/collect.js` before writing (Stage 1 → Stage 2 contract) |
| `ReportSchema` | `data/reports/YYYY-MM-DD.json` | `scripts/analyze.sh` after agent writes report |
| `MemorySchema` | `data/memory.json` | `scripts/analyze.sh` after agent writes memory |

**If validation fails, the pipeline aborts.** This catches schema drift between LLM output and template expectations early — before broken data reaches `_site/`.

Note: `ReportSchema` uses `.passthrough()` at the top level and makes most sub-fields optional. This is intentional: the LLM output shape drifts slightly. A strict schema would reject cosmetically varied but semantically valid reports. The template layer handles missing fields gracefully (empty render rather than crash).

## Output

- **Static HTML** built in CI by 11ty, deployed to GitHub Pages via `actions/deploy-pages@v4` (OIDC artifact, not a `gh-pages` branch).
- **Live URL:** https://bolin8017.github.io/ai-daily-report
- **Archive:** `data/reports/YYYY-MM-DD.json` committed to git; 11ty pagination generates `_site/archive/YYYY-MM-DD.html` during build. Footer shows last 7; all reports kept permanently.
- **RSS feed:** `_site/feed.xml`

## State Management

All of these live on the `data` branch (not `main`). Hydrated into the working tree by `scripts/docker-entrypoint.sh` on each container run, and by `.github/workflows/deploy.yml` on each CI build.

- `data/memory.json` — v2 schema: `short_term` (7-day) + `long_term` (30-day promotion), `topics` (frequency tracking), `narrative_arcs` (multi-day patterns), `predictions` (with status tracking).
- `data/reports/YYYY-MM-DD.json` — daily reports; any update to this tree on the `data` branch triggers CI deploy via the workflow's paths filter. 11ty reads this directory to generate archive pages via pagination.
- `data/feeds-snapshot.json` — condensed snapshot for 11ty templates (sources status + community feeds).
- `data/staging/` — Stage 1 output consumed by Stage 2: 4 condensed JSON files + `metadata.json` (validated against `StagingMetadataSchema`).

## Environment

Required:
- `GITHUB_TOKEN` — PAT with `Contents: read/write` scope. Used by Octokit fetchers AND as the commit/push credential inside the container (see `src/lib/commit.js`, which rewrites `origin` to `https://x-access-token:$GITHUB_TOKEN@github.com/...`). On the VM, stored in `~/.ai-daily-report.env`. Locally, loaded from `.env`.
- **Claude Code subscription** — `claude -p` in `scripts/analyze.sh` draws from the Max subscription (not API billing). Credentials live in `~/.claude` and are bind-mounted into the container.
- **RSSHub** — `config.json → sources.rsshub_urls` is an ordered list of public instances. `src/fetchers/feeds.js` tries each URL in order per request, falling through on `5xx` / timeout / network error. `4xx` is treated as a route-level error (no retry). See `config.json` for the authoritative list.

Optional:
- `RSSHUB_URL` — env var override. Forces a single URL and **disables the fallback list** — intended for local debugging against a private instance. Production should leave this unset and let `config.json` provide the ordered list.
- `REPORT_TIMEZONE` — default `Asia/Taipei`.
- `CLAUDE_MODEL` — override the model passed to `claude -p`; default `claude-opus-4-6`.
- `SKIP_PUSH=1` — skip `git push` in both stages; also accessible as `--skip-push` CLI flag on `src/collect.js`.

See `.env.example` for all variables.

## CI/CD

| Workflow | Trigger | Job |
|---|---|---|
| `.github/workflows/deploy.yml` | (a) push to `main` matching the deploy paths (code/site/workflow changes), OR (b) pull_request matching the wider validation paths (`src/**`, `tests/**`, `scripts/**`, configs included), OR (c) `schedule: '0 21 * * *'` (21:00 UTC = 05:00 Asia/Taipei, ~1h after VM pipeline starts), OR (d) manual `workflow_dispatch`. Note: pushes to the `data` branch **do not** fire the workflow — the orphan `data` branch has no `.github/workflows/` tree, which is why the schedule trigger exists as the primary auto-deploy path for bot reports. | `build` job runs always: checkout `main` → hydrate `data/` from `data` branch → lint + tests + schema validation + 11ty build. `deploy` job runs on every event except `pull_request`: `upload-pages-artifact` → `deploy-pages` OIDC. PR validation ends after `build`. Concurrency group is per-PR (cancel-in-progress) for PRs and shared `pages` for everything else. |

GitHub Pages source: **GitHub Actions** (`build_type: workflow`). No legacy `gh-pages` branch.

**Node 24 opt-in**: the workflow sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` at the top level so `actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact`, and `actions/deploy-pages` all run on Node 24. This is ahead of GitHub's 2026-06-02 forced migration (Node 20 removal from runners on 2026-09-16). Once all official action versions default to Node 24 (expected by June), the env var can be removed.

## Notes

- **Scheduling**: production runs happen on the production VM via systemd timer at 04:00 Asia/Taipei. Timer has `Persistent=true` (catches up after reboot) and `OnFailure=` (triggers alert). Logs: `journalctl -u ai-daily-report`.
- **Schema-first**: when changing report sections, update `src/schemas/report.js` first, then the agent prompt, then the templates. This catches mismatches at validate time.
- **Git push auth** — `src/lib/commit.js` embeds `$GITHUB_TOKEN` into the push URL (`https://x-access-token:TOKEN@github.com/...`). Unlike the previous host-helper approach, this works inside the Docker container without needing gh CLI or SSH keys. The old `.env GITHUB_TOKEN is ignored for push` caveat no longer applies.
- **External RSSHub dependency** — `config.json → sources.rsshub_urls` lists public instances tried in order. `feeds.js` falls through automatically on any per-request error (timeout, 5xx, network), so a single instance going slow or down degrades one request, not the whole run. `src/fetchers/all.js` additionally tolerates 1 of 4 fetchers failing at the fetcher level. To add a new instance, append its URL to the list; to force one instance for debugging, set `RSSHUB_URL=...` (which bypasses the list).
- **Fetcher dual-mode** — every fetcher (`src/fetchers/*.js`) exports an importable async function AND still works as a standalone CLI that writes JSON to stdout. `src/fetchers/_dispatch.js` is the shared helper that detects CLI mode and emits the envelope. Useful for ad-hoc debugging: `GITHUB_TOKEN=... node src/fetchers/github-trending.js | jq '.items | length'`.
- Report sections (see `.claude/agents/daily-report.md`): `lead.html` (senior-analyst briefing with `h3` + 4 `h4` subsections), `ideas[]` (3 remix ideas, ≥1 non-AI), `shipped[]` (12-20 items mixing 4 fetchers, with 3-5 discovery picks from github-search), `pulse.curated/hn/lobsters`, `dev_watch.taiwan/global` (≤5 per region), `signals[]` (3-4 patterns with mechanism), `sleeper`, `contrarian` (binary falsifiable prediction), `predictions[]` (5-7 total, all binary).

## Quality bar

- All `data/*.json` validate against Zod schemas — staging metadata in `src/collect.js`, report + memory in `scripts/analyze.sh`. Schema drift aborts the run before any commit.
- All JS/JSON formatted with Biome (`npm run lint` on every CI run).
- Vitest schema tests run on `npm test` and in CI.
- Conventional commits encouraged.
- **Agent prompt is the quality lever** (`.claude/agents/daily-report.md`, ~485 lines). It's **outcome-oriented, not mechanism-prescriptive**: instead of hard count/length rules, it describes the reader persona (AI engineer who builds), gives positive paragraph examples of good vs slop voice, enumerates ~12 Chinese translation-smell patterns for structural anti-slop, and applies a "single slop test" (delete every sentence that, if removed, wouldn't make the reader lose a specific number / name / version / concrete claim). The prompt was calibrated against 4 external reviewers (tech editor / Chinese-language editor / strategy analyst / non-AI product manager) who independently flagged issues invisible to in-domain review (kebab-case slug leaks, unverifiable "first-ever" superlatives, internal contradictions, pattern-matching to overconfidence, audience split-personality). See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design philosophy.
