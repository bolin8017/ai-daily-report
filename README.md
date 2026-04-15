# AI Daily Report

[![Live](https://img.shields.io/badge/live-bolin8017.github.io/ai--daily--report-e2a84b)](https://bolin8017.github.io/ai-daily-report/)
[![Deploy](https://github.com/bolin8017/ai-daily-report/actions/workflows/deploy.yml/badge.svg)](https://github.com/bolin8017/ai-daily-report/actions/workflows/deploy.yml)

An automated daily tech brief for **AI engineers who build** — RAG, VLM, fine-tuning, agents, MCP. A Claude Code agent collects signals from 15+ sources, synthesizes them into a senior-analyst-style brief, and publishes to GitHub Pages. Every day at 04:00 Asia/Taipei, zero human intervention.

> **Live:** https://bolin8017.github.io/ai-daily-report/

## How it works

```
systemd timer → Docker container (GCP e2-micro)
  ├── Stage 1: Node.js fetchers → condense → commit staging data
  └── Stage 2: claude -p (Opus 4.6) → read staging → write report → commit

GitHub Actions cron (daily 21:00 UTC) → pull from `data` branch → 11ty → Pages
```

**Stage 1** fetches GitHub Trending, GitHub topic search, Hacker News, Lobsters, Dev.to, HuggingFace Daily Papers, and ~10 RSS sources in parallel, then condenses each to fit the LLM context budget.

**Stage 2** invokes `claude -p` with Read/Write tool access. The agent reads staged data, applies the analyst prompt, writes a structured JSON report, and validates it against Zod schemas before committing.

See [docs/architecture.md](./docs/architecture.md) for design decisions and trade-offs.

## Report sections

| Section | Content |
|---|---|
| **動手做 — 混搭靈感** | 3 side-project ideas with tech stack, hardware needs, difficulty grading |
| **今日上線** | 12–20 curated items: HN, Lobsters, AI lab news, discovery picks, developer watch |
| **社群脈動** | "If you only read 5 things" curated list + raw community feeds |
| **趨勢訊號** | Lead analysis, trend signals, sleeper pick, contrarian take, binary predictions |

## Quick start

```bash
git clone https://github.com/bolin8017/ai-daily-report.git
cd ai-daily-report
npm ci
cp .env.example .env   # then set GITHUB_TOKEN

npm start              # Stage 1 only (fetch + condense, no LLM)
bash scripts/run.sh --full       # Stage 1 + Stage 2 (requires claude login)
bash scripts/run.sh --skip-push  # Full pipeline, no git push
npm run serve          # 11ty dev server with live reload
```

**Prerequisites:** Node.js 22+, GitHub PAT with `Contents: read/write`, Claude Code subscription (for Stage 2).

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

## Tech stack

| Layer | Tool |
|---|---|
| Runtime | GCP e2-micro (free tier), Docker, systemd timer |
| LLM | Claude Opus 4.6 via `claude -p` (Max subscription) |
| Data | [Octokit](https://github.com/octokit/octokit.js), [cheerio](https://github.com/cheeriojs/cheerio), [rss-parser](https://github.com/rbren/rss-parser), [RSSHub](https://github.com/DIYgod/RSSHub) |
| Validation | [Zod](https://github.com/colinhacks/zod) |
| Site | [11ty](https://github.com/11ty/eleventy) (Nunjucks) |
| CI/CD | GitHub Actions → Pages (OIDC deploy) |
| Code quality | [Biome](https://github.com/biomejs/biome), [Vitest](https://github.com/vitest-dev/vitest) |

## Documentation

- [docs/architecture.md](./docs/architecture.md) — design decisions, trade-offs, failure modes
- [CLAUDE.md](./CLAUDE.md) — project structure, commands, schemas, environment setup
- [CONTRIBUTING.md](./CONTRIBUTING.md) — contribution guidelines

## License

MIT — see [LICENSE](./LICENSE).
