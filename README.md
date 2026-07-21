# AI Daily Report

[![Live](https://img.shields.io/badge/live-bolin8017.github.io/ai--daily--report-e2a84b)](https://bolin8017.github.io/ai-daily-report/)
[![Deploy](https://github.com/bolin8017/ai-daily-report/actions/workflows/deploy.yml/badge.svg)](https://github.com/bolin8017/ai-daily-report/actions/workflows/deploy.yml)

An automated daily tech brief for **AI engineers who build** — RAG, VLM, fine-tuning, agents, MCP. A Claude Code agent collects signals from 15+ sources, synthesizes them into a senior-analyst-style brief, and publishes to GitHub Pages. Every day at 08:30 Asia/Taipei, zero human intervention.

> **Live:** https://bolin8017.github.io/ai-daily-report/

## How it works

```
Hermes cron / operator trigger → repository pipeline
  ├── Stage 1 (collect):    Node.js fetchers → condense → snapshot (staging)
  ├── Stage 2 (curate):     4× claude -p (Haiku 4.5) → curated/<section>.json
  ├── Stage 2.5 (context):  Hermes Wiki → bounded report-context.md
  ├── Stage 3 (synthesize): claude -p (Sonnet 4.6) → editorial.json only
  └── Stage 4 (merge):      mechanical compose → report.json → validate → commit

repository_dispatch after data push → GitHub Actions → 11ty → Pages
```

**Stage 1 (collect)** fetches GitHub Trending, GitHub topic search, Hacker News, Lobsters, Dev.to, HuggingFace Daily Papers, and ~10 RSS sources in parallel, then condenses each to fit the LLM context budget. Output stays in local staging (`data/staging/`) — not committed to the `data` branch.

**Stage 2 (curate)** runs four parallel `claude -p` subprocesses (one per section: shipped / pulse / market / tech), each on Haiku 4.5. Each applies its section curator prompt and writes validated `data/staging/curated/<section>.json`.

**Stage 3 (synthesize)** runs a single `claude -p` on Sonnet 4.6. It reads the curated sections plus a bounded `data/staging/report-context.md` generated from the local Hermes Wiki, applies the editorial prompt, and writes **only** the editorial layer (`data/staging/editorial.json`: lead, signals, ideation). It no longer reads or writes `data/memory.json`.

**Stage 4 (merge)** is mechanical (no LLM): it composes `data/reports/<date>.json` from `editorial.json` + `curated/*.json`, drops any dangling `source_links` (degrading the citing item rather than aborting the report), validates against Zod schemas, then commits to the `data` branch.

See [docs/architecture.md](./docs/architecture.md) for design decisions, system diagrams, and end-to-end flow. Historical and superseded design/migration docs are in [docs/archive/](./docs/archive/).

## Report sections

The report is a single unified document with six top-level tabs (schema `2.1`):

| Tab | Content |
|---|---|
| **訊號** | Lead analysis, focus / sleeper / contrarian signals, binary predictions |
| **動手做** | Side-project ideas with tech stack, hardware needs, difficulty grading |
| **上線** | Curated launches: GitHub trending, topic discovery, developer watch |
| **脈動** | Community pulse: Hacker News, Lobsters, Chinese community, AI bloggers |
| **市場** | M&A, funding, policy, Taiwan industry moves |
| **技術** | Vendor updates, models, benchmarks, deep dives |

## Quick start

```bash
git clone https://github.com/bolin8017/ai-daily-report.git
cd ai-daily-report
npm ci
cp .env.example .env   # then set GITHUB_TOKEN

npm start              # Stage 1 only (collect: fetch + condense, no LLM)
bash scripts/run.sh --full       # Stages 1–4 (curate → synthesize → merge; requires claude login)
bash scripts/run.sh --skip-push  # Full pipeline, no git push
npm run serve          # 11ty dev server with live reload
```

**Prerequisites:** Node.js 22+, GitHub PAT with `Contents: read/write`, Claude Code subscription (for Stages 2–3).

## Data sources

| Source | Method |
|---|---|
| GitHub Trending | cheerio scraper + Octokit enrichment |
| GitHub Topic Search | Octokit REST API, freshness-first (`created:>30d`, `stars:>100`) |
| GitHub Developer Watch | Top developers (global + regional) newest repos |
| Hacker News | RSSHub + Algolia API enrichment (scores, comments) |
| Lobsters | Native JSON API |
| Dev.to, Anthropic News, HuggingFace Papers | RSSHub |
| Simon Willison, Karpathy, Google AI Blog, Phoronix, LWN, etc. | Native RSS |

Full per-source breakdown (with URLs and categories): [docs/data-sources.md](./docs/data-sources.md). The source list lives in `themes/<theme>/sources.yaml` (`config.json` is now an empty placeholder). Run `npm run check:sources` to verify the doc stays in sync.

## Tech stack

| Layer | Tool |
|---|---|
| Runtime | Hermes cron (08:30 Asia/Taipei) / local operator workflow |
| LLM | Claude Haiku 4.5 (curators) + Sonnet 4.6 (synthesizer) via `claude -p` (Max subscription) |
| Data | [Octokit](https://github.com/octokit/octokit.js), [cheerio](https://github.com/cheeriojs/cheerio), [rss-parser](https://github.com/rbren/rss-parser), [RSSHub](https://github.com/DIYgod/RSSHub) |
| Validation | [Zod](https://github.com/colinhacks/zod) |
| Site | [11ty](https://github.com/11ty/eleventy) (Nunjucks) |
| CI/CD | GitHub Actions → Pages (OIDC deploy) |
| Code quality | [Biome](https://github.com/biomejs/biome), [Vitest](https://github.com/vitest-dev/vitest) |

## Documentation

- [docs/architecture.md](./docs/architecture.md) — **canonical system architecture**: design, diagrams, end-to-end flow, trade-offs
- [docs/data-sources.md](./docs/data-sources.md) — full catalogue of fetched sources, URLs, and lens overlays
- [CLAUDE.md](./CLAUDE.md) — project structure, commands, schemas, environment setup
- [docs/archive/](./docs/archive/) — historical/superseded docs (Hermes migration guide, firewall allowlist, the cron-migration design)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution guidelines

## License

MIT — see [LICENSE](./LICENSE).
