# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

An AI-powered daily creative tech brief for **AI engineers who build** (RAG / VLM / fine-tuning / agent / MCP). Every day, a Claude Code agent collects signals from GitHub Trending, GitHub topic search (freshness-first, ≤30-day-old repos), GitHub developer activity, Hacker News, Lobsters, Dev.to, Anthropic News, HuggingFace Daily Papers, and ~10 other RSS sources (Simon Willison, Karpathy, Gary Marcus, Google AI Blog, Phoronix, LWN, etc.), then synthesizes them into a deep analyst-style brief published to GitHub Pages.

The tone is **senior analyst briefing a busy CTO** — FT / Bloomberg / The Information / Stratechery voice — not corporate marketing. Mechanism over metaphor, specific over generic, builder-oriented action advice over decision-maker strategy talk. The audience is deliberately locked to builders (not PMs, not founders, not decision-makers); if a section drifts into "talk to your CTO about vendor strategy" territory, the prompt's Step 7 self-check catches it.

For the public-facing overview and quick start, see [README.md](./README.md). For design decisions and trade-offs, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Deployment mode

The pipeline runs as a **single Node.js process** (`src/pipeline.js`) that fetches sources in parallel, calls `claude -p` twice (once for the report, once to update memory), validates the outputs against Zod schemas, and commits + pushes to `origin main`. GitHub Actions then builds the 11ty site and deploys to Pages.

**Production runtime**: a Google Cloud e2-micro VM (always-free tier, us-west1) runs the pipeline daily at 04:00 Asia/Taipei via `cron` → `scripts/cron-run.sh` → `docker run ai-daily-report:latest`. The Docker image contains only Node 22, git, and the Claude Code CLI; the repo is cloned into a persistent Docker volume at `/workspace` and refreshed via `git pull` on each run.

**Why VM instead of Anthropic Cloud Runtime**: the earlier CCR design (agent-driven, 22 tool calls per run) hit two architectural walls — nested `claude -p` subprocesses deadlocked on SSE keepalives, and the 10K-token Read tool limit made a single merged digest file unviable. A bare VM has neither constraint: `claude -p` runs as the primary session, and all data flows in-process via Node objects. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full rationale.

**VM environment requirements** (managed by `scripts/setup-vm.sh`):

| Setting | Value | Why |
|---|---|---|
| **Swap** | 2GB file at `/swapfile` | e2-micro has only 958MB RAM shared with host services (uvicorn + caddy + docker). LLM synthesis peaks need headroom to avoid OOM. |
| **Docker image** | `ai-daily-report:latest`, built locally from `Dockerfile` | Contains Node 22 + git + `@anthropic-ai/claude-code` CLI. No project code baked in — code flows via `git pull` on each run. |
| **Docker volume** | `ai-daily-report-workspace` | Persists the cloned repo + `node_modules` between runs so cold starts stay <10s. |
| **Claude auth** | Bind mount `~/.claude` from host → `/root/.claude` in container | One-time interactive `claude /login` inside the container creates credentials that persist across cron invocations. |
| **Secrets** | `~/.ai-daily-report.env` with `GITHUB_TOKEN=ghp_...` | Loaded by `scripts/cron-run.sh`, injected into container via `-e GITHUB_TOKEN`. |
| **Memory limits** | `docker run --memory=600m --memory-swap=1g` | Caps the pipeline so an OOM never kills the host's other services. |
| **Timezone** | `TZ=Asia/Taipei` in crontab | VM is UTC; the pipeline needs local date for `YYYY-MM-DD` computation. |

## How to Run

| Command | What it does |
|---|---|
| `npm start` | Local dev: runs `scripts/run.sh` → `node src/pipeline.js --dry-run` (fetch + snapshot + condense only, skips `claude -p`). |
| `bash scripts/run.sh --full` | Full local pipeline including both `claude -p` calls (requires host Claude Code login). |
| `bash scripts/run.sh --skip-push` | Full pipeline but without the final `git push`, useful for iteration on prompts. |
| `npm run pipeline` / `npm run pipeline:dry` | Direct invocation of `node src/pipeline.js` with or without `--dry-run`. |
| `node src/fetchers/feeds.js` | Any single fetcher can still be run standalone; all 4 fetchers are dual-mode (importable + CLI). |
| `node src/lib/condense.js` | Standalone mode reads `tmp/*.json`, writes `tmp/*-condensed.json` — useful for debugging the condense budget. |
| `npm run build` | Rebuild the static site from committed `data/reports/*.json`. |
| `npm run serve` | 11ty dev server with live reload. |
| `npm test` | Vitest unit tests for schemas + synthesize + condense. |
| `npm run lint` / `npm run format` | Biome check / format --write. |
| `npm run validate:report` | Validate the newest report in `data/reports/` against `ReportSchema`. |

**VM operations** (on the homelab VM):
- `bash scripts/setup-vm.sh` — one-time install (swap + Docker + image build). Idempotent.
- `bash scripts/cron-run.sh` — one-off manual run, same path cron uses.
- Crontab entry: see `scripts/setup-vm.sh` output.

## Project Structure

```
.
├── src/
│   ├── pipeline.js               # Main entry — orchestrates fetch → condense → synthesize → validate → commit
│   ├── fetchers/                 # All dual-mode (importable + standalone CLI)
│   │   ├── _dispatch.js          # Shared helper that detects CLI mode and emits JSON
│   │   ├── all.js                # Parallel runner — used by pipeline.js
│   │   ├── feeds.js              # Unified RSSHub + RSS + JSON API fetcher
│   │   ├── github-trending.js    # cheerio + Octokit GitHub trending scraper
│   │   ├── github-search.js     # GitHub Search API by topic (freshness-first)
│   │   └── github-developers.js  # Top GitHub developers' newest repos (global + regional)
│   ├── schemas/                  # Zod schemas (single source of truth)
│   │   ├── config.js
│   │   ├── feed-item.js
│   │   ├── memory.js
│   │   └── report.js
│   └── lib/
│       ├── validate.js           # CLI schema validator
│       ├── snapshot.js           # Committed feeds-snapshot.json builder (dual-mode)
│       ├── condense.js           # Per-source ≤8500-token condenser (dual-mode)
│       ├── synthesize.js         # claude -p wrapper; synthesizeReport + synthesizeMemory + extractJson
│       └── commit.js             # git add/commit/push with GITHUB_TOKEN-based push auth
├── scripts/
│   ├── run.sh                    # Local dev wrapper around node src/pipeline.js (defaults to --dry-run)
│   ├── cron-run.sh               # Host cron entry: loads secrets + runs the Docker image with memory caps
│   ├── docker-entrypoint.sh      # Inside-container entry: git clone/pull + npm ci + exec pipeline.js
│   └── setup-vm.sh               # One-time VM setup: swap + Docker + image build + OAuth instructions
├── Dockerfile                    # node:22-slim + git + tini + @anthropic-ai/claude-code (no project code)
├── .dockerignore
├── site/                         # 11ty source templates (Nunjucks)
│   ├── _includes/                # base.njk, report-body.njk, idea-card.njk, shipped-item.njk
│   ├── assets/                   # style.css + app.js (tab + filter logic)
│   ├── feed.njk                  # RSS feed template
│   ├── index.njk                 # Main page (includes report-body.njk)
│   └── archive.njk              # Archive pages via 11ty pagination
├── tests/
│   └── schemas.test.js           # Vitest smoke tests for all Zod schemas
├── data/                         # Committed state — triggers CI deploy on change
│   ├── reports/                  # Daily reports (YYYY-MM-DD.json, git-tracked, dated-only)
│   ├── memory.json               # v2 cross-day state
│   └── feeds-snapshot.json       # Condensed snapshot for 11ty templates
├── docs/                         # 11ty build output (gitignored — built in CI)
├── .github/workflows/deploy.yml  # CI: build + deploy to GitHub Pages via OIDC
├── .claude/
│   ├── agents/daily-report.md    # Agent prompt (embedded in synthesizeReport)
│   └── daily-report-quality.md   # Voice / slop rules (embedded in synthesizeReport)
├── biome.json                    # Biome lint + format config
└── eleventy.config.js            # 11ty build config (ESM)
```

## Data Sources

### `src/fetchers/feeds.js` (RSSHub + native APIs)
Via RSSHub (public instance `https://rsshub.pseudoyu.com`, fallback `https://rsshub.rssforever.com`):
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
| `ReportSchema` | `data/reports/YYYY-MM-DD.json` | `src/pipeline.js` after `synthesizeReport` |
| `MemorySchema` | `data/memory.json` | `src/pipeline.js` after `synthesizeMemory` |

**If validation fails, the pipeline aborts.** This catches schema drift between LLM output and template expectations early — before broken data reaches `docs/`.

Note: `ReportSchema` uses `.passthrough()` at the top level and makes most sub-fields optional. This is intentional: the LLM output shape drifts slightly. A strict schema would reject cosmetically varied but semantically valid reports. The template layer handles missing fields gracefully (empty render rather than crash).

## Output

- **Static HTML** built in CI by 11ty, deployed to GitHub Pages via `actions/deploy-pages@v4` (OIDC artifact, not a `gh-pages` branch).
- **Live URL:** https://bolin8017.github.io/ai-daily-report
- **Archive:** `data/reports/YYYY-MM-DD.json` committed to git; 11ty pagination generates `docs/archive/YYYY-MM-DD.html` during build. Footer shows last 7; all reports kept permanently.
- **RSS feed:** `docs/feed.xml`

## State Management

- `data/memory.json` — v2 schema: `short_term` (7-day) + `long_term` (30-day promotion), `topics` (frequency tracking), `narrative_arcs` (multi-day patterns), `predictions` (with status tracking)
- `data/reports/YYYY-MM-DD.json` — committed daily reports; changes to `data/reports/**` trigger the CI deploy via the workflow's paths filter. 11ty reads this directory to generate archive pages via pagination.
- `data/feeds-snapshot.json` — committed condensed snapshot that CI can read without `tmp/`.

## Environment

Required:
- `GITHUB_TOKEN` — PAT with `Contents: read/write` scope. Used by Octokit fetchers AND as the commit/push credential inside the container (see `src/lib/commit.js`, which rewrites `origin` to `https://x-access-token:$GITHUB_TOKEN@github.com/...`). On the VM, stored in `~/.ai-daily-report.env`. Locally, loaded from `.env`.
- **Claude Code subscription** — `claude -p` in `src/lib/synthesize.js` draws from the Max subscription (not API billing). Credentials live in `~/.claude` and are bind-mounted into the container.
- **RSSHub** — `config.json → sources.rsshub_url`, defaults to `https://rsshub.pseudoyu.com`. Fallback: `https://rsshub.rssforever.com`.

Optional:
- `RSSHUB_URL` — env var override for the RSSHub URL (otherwise read from `config.json`).
- `REPORT_TIMEZONE` — default `Asia/Taipei`.
- `CLAUDE_MODEL` — override the model passed to `claude -p`; default `claude-sonnet-4-6`.
- `DRY_RUN=1` / `SKIP_PUSH=1` — behaviour flags for `src/pipeline.js`, also accessible as `--dry-run` / `--skip-push` CLI flags.

See `.env.example` for all variables.

## CI/CD

| Workflow | Trigger | Job |
|---|---|---|
| `.github/workflows/deploy.yml` | push to `main` that touches `data/reports/**`, `data/feeds-snapshot.json`, `site/**`, `eleventy.config.js`, `package.json`, or `package-lock.json` | Lint + tests + schema validation + 11ty build → `upload-pages-artifact` → `deploy-pages` OIDC |

GitHub Pages source: **GitHub Actions** (`build_type: workflow`). No legacy `gh-pages` branch.

**Node 24 opt-in**: the workflow sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` at the top level so `actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact`, and `actions/deploy-pages` all run on Node 24. This is ahead of GitHub's 2026-06-02 forced migration (Node 20 removal from runners on 2026-09-16). Once all official action versions default to Node 24 (expected by June), the env var can be removed.

## Notes

- **Scheduling**: production runs happen on the homelab VM via cron at 04:00 Asia/Taipei. Crontab uses `TZ=Asia/Taipei 0 4 * * * scripts/cron-run.sh >> /var/log/ai-daily-report.log 2>&1`.
- **Schema-first**: when changing report sections, update `src/schemas/report.js` first, then the agent prompt, then the templates. This catches mismatches at validate time.
- **Git push auth** — `src/lib/commit.js` embeds `$GITHUB_TOKEN` into the push URL (`https://x-access-token:TOKEN@github.com/...`). Unlike the previous host-helper approach, this works inside the Docker container without needing gh CLI or SSH keys. The old `.env GITHUB_TOKEN is ignored for push` caveat no longer applies.
- **External RSSHub dependency** — the pipeline points at `https://rsshub.pseudoyu.com`. If it goes down, fall back to `https://rsshub.rssforever.com` by updating `config.json → sources.rsshub_url` (or pass `RSSHUB_URL`). `src/fetchers/all.js` tolerates 1 of 4 fetchers failing.
- **Fetcher dual-mode** — every fetcher (`src/fetchers/*.js`) exports an importable async function AND still works as a standalone CLI that writes JSON to stdout. `src/fetchers/_dispatch.js` is the shared helper that detects CLI mode and emits the envelope. Useful for ad-hoc debugging: `GITHUB_TOKEN=... node src/fetchers/github-trending.js | jq '.items | length'`.
- Report sections (see `.claude/agents/daily-report.md`): `lead.html` (senior-analyst briefing with `h3` + 4 `h4` subsections), `ideas[]` (3 remix ideas, ≥1 non-AI), `shipped[]` (12-20 items mixing 4 fetchers, with 3-5 discovery picks from github-search), `pulse.curated/hn/lobsters`, `dev_watch.taiwan/global` (≤5 per region), `signals[]` (3-4 patterns with mechanism), `sleeper`, `contrarian` (binary falsifiable prediction), `predictions[]` (5-7 total, all binary).

## Quality bar

- All `data/*.json` validate against Zod schemas at the end of `src/pipeline.js`. Schema drift aborts the run before any commit.
- All JS/JSON formatted with Biome (`npm run lint` on every CI run).
- Vitest schema tests run on `npm test` and in CI.
- Conventional commits encouraged.
- **Agent prompt is the quality lever** (`.claude/agents/daily-report.md`, ~485 lines). It's **outcome-oriented, not mechanism-prescriptive**: instead of hard count/length rules, it describes the reader persona (AI engineer who builds), gives positive paragraph examples of good vs slop voice, enumerates ~12 Chinese translation-smell patterns for structural anti-slop, and applies a "single slop test" (delete every sentence that, if removed, wouldn't make the reader lose a specific number / name / version / concrete claim). The prompt was calibrated against 4 external reviewers (tech editor / Chinese-language editor / strategy analyst / non-AI product manager) who independently flagged issues invisible to in-domain review (kebab-case slug leaks, unverifiable "first-ever" superlatives, internal contradictions, pattern-matching to overconfidence, audience split-personality). See [ARCHITECTURE.md](./ARCHITECTURE.md) for the design philosophy.
