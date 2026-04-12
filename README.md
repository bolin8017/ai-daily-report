# AI Daily Report

[![Live](https://img.shields.io/badge/live-bolin8017.github.io/ai--daily--report-e2a84b)](https://bolin8017.github.io/ai-daily-report/)
[![Deploy](https://github.com/bolin8017/ai-daily-report/actions/workflows/deploy.yml/badge.svg)](https://github.com/bolin8017/ai-daily-report/actions/workflows/deploy.yml)

AI-powered daily creative tech brief for AI engineers who build. A Claude Code agent collects signals from GitHub Trending, GitHub topic search (freshness-first, ≤30-day-old repos), Hacker News, Lobsters, Dev.to, Anthropic News, HuggingFace Daily Papers, and ~15 RSS sources; synthesizes them into a senior-analyst daily brief with concrete side-project ideas and binary-falsifiable predictions; and publishes to GitHub Pages.

**Core value:** not "what's trending" but **"what should an AI engineer who builds (RAG, VLM, fine-tuning, agents, MCP) change in their stack or weekend plans today"**. The brief is deliberately builder-focused — no vendor-strategy punditry, no business-model talk, no decision-maker framing. If you're looking for "should my company buy Claude or GPT", this isn't it. If you're looking for "today's discovery picks I should clone" and "this week's idea I should actually try", it is.

> **Live:** https://bolin8017.github.io/ai-daily-report/

## How it works

```mermaid
flowchart LR
  Timer[systemd timer<br/>04:00 Asia/Taipei] --> Docker[Docker container]

  subgraph Docker["GCP e2-micro VM"]
    S1[Stage 1: collect.js<br/>fetch → condense → commit staging]
    S1 --> S2[Stage 2: analyze.sh<br/>claude -p with tools<br/>Read/Write]
    S2 --> Push[git push main]
  end

  Push --> GHA[GitHub Actions]

  subgraph GHA["GITHUB ACTIONS"]
    Build[11ty build]
    Build --> Deploy[deploy-pages OIDC]
  end

  Deploy --> Pages[🌐 bolin8017.github.io/ai-daily-report]
```

**Why this architecture?** The pipeline runs on a GCP e2-micro VM via systemd timer. Stage 1 (pure Node.js) fetches and condenses data. Stage 2 invokes `claude -p` with tool access — the agent reads staged data via Read tool, analyzes, and writes report + memory via Write tool. This avoids the subprocess hang that blocked the old single-process design. Build and deploy stay in GitHub Actions because they're deterministic, free, and keep the deploy path push-driven. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design rationale.

## Report sections

| Tab | Content |
|---|---|
| **動手做 — 混搭靈感** | 3 concrete side-project ideas, each with a role-anchored use case, tech stack, hardware needs, honest difficulty + dev-time grading, and a first-step command. At least one idea is non-AI/dev-tooling (hardware, civic tech, science) |
| **今日上線** | 12–20 curated items mixing HN / Lobsters / AI lab RSS / **discovery picks from GitHub topic search** (freshly-created ≥100★ repos surfaced before they hit trending) + developer watch (high-follower devs' new repos from last 72h) |
| **社群脈動** | Agent-curated "if you only read 5 things" list + raw HN / Lobsters / community feeds for drill-down |
| **趨勢訊號** | Lead story (senior-analyst briefing: 發生了什麼 → 為什麼重要 → 社群怎麼看 → 行動建議) + 3–4 trend signals with cross-source evidence + sleeper pick with commercial path + contrarian take with binary falsifiable prediction + 5–7 dated binary predictions |

## Scheduled deployment

The pipeline runs in two stages inside a Docker container on a Google Cloud e2-micro VM (always-free tier), triggered daily by a systemd timer at 04:00 Asia/Taipei:

1. **systemd timer** fires `scripts/cron-run.sh`, which `docker run`s `ai-daily-report:latest` with `--memory=600m` and the host's `~/.claude` + `GITHUB_TOKEN` bind-mounted in
2. **Stage 1** — `collect.js` fetches 4 sources in parallel, condenses them, and commits staging data to git
3. **Stage 2** — `analyze.sh` invokes `claude -p` (Opus 4.6) with `--allowedTools` for Read/Write access; the agent reads staged data, writes `data/reports/YYYY-MM-DD.json` + `data/memory.json`, validates against Zod schemas, and commits
4. **git push** sends both commits to `origin main`
5. **GitHub Actions** picks up the push and deploys to Pages

**External dependency:** RSSHub instance at `https://rsshub.pseudoyu.com` (public, community-maintained by [@pseudoyu](https://github.com/pseudoyu)). Fallback: `https://rsshub.rssforever.com`.

## Quick start (local dev)

Use this only if you're iterating on code, prompts, or templates. Scheduled production runs don't need any of this.

### Prerequisites

- **Node.js 22+**
- **Claude Code subscription** (Max plan recommended for Opus access)
- **GitHub token** with `Contents: read/write` scope (for the fetchers' Octokit calls)

### Setup

```bash
git clone https://github.com/bolin8017/ai-daily-report.git
cd ai-daily-report
npm ci

# Set up env
cp .env.example .env
# Edit .env: GITHUB_TOKEN=ghp_...

# One-time Claude Code login (only needed for --full runs)
claude    # then /login in the REPL

# Stage 1 only — fetch + condense + snapshot (no LLM call, no push)
npm start

# Stage 1 + Stage 2 — full pipeline including claude -p (requires Claude login)
bash scripts/run.sh --full

# Full pipeline but skip git push — useful for prompt iteration
bash scripts/run.sh --skip-push

# Stage 2 only — analyze existing staging data (assumes Stage 1 already ran)
bash scripts/run.sh --analyze
```

`npm start` runs Stage 1 only (collect, no push) — use this while iterating on fetchers or templates. `--full` runs both stages and git-pushes at the end. `--skip-push` does both stages but leaves the result unpushed. `--analyze` skips collection and runs Stage 2 directly against existing staging data.

## Project structure

See [CLAUDE.md](./CLAUDE.md) for the full file-by-file guide.

```
src/
  collect.js        # Stage 1 — fetch → condense → snapshot → commit staging
  fetchers/         # Dual-mode JS fetchers (feeds, trending, search, developers)
  schemas/          # Zod schemas — single source of truth (including staging contract)
  lib/              # condense, snapshot, commit
scripts/
  analyze.sh        # Stage 2 — assemble prompt → claude -p → validate → commit
  run.sh            # Local dev wrapper
  cron-run.sh       # Docker invocation (used by systemd service)
  docker-entrypoint.sh  # Inside-container entry (collect/analyze/both)
  setup-vm.sh       # One-time VM install (Docker + systemd timer)
systemd/            # Timer + service + failure notification units
Dockerfile          # node:22-slim + git + claude CLI
site/               # 11ty templates (Nunjucks)
data/               # Committed state (reports/, staging/, memory.json)
tests/              # Vitest unit tests
```

## Development

```bash
npm test                 # Vitest schema tests
npm run lint             # Biome check
npm run format           # Biome format --write
npm run validate:report  # Validate latest data/reports/YYYY-MM-DD.json against ReportSchema
npm run serve            # 11ty dev server with live reload
```

## What's externally maintained vs self-maintained

| Concern | Tool | Why |
|---|---|---|
| **Scheduling runtime** | GCP e2-micro VM (always-free) + systemd timer + Docker | Zero monthly cost, full control, reliable scheduling with failure notifications |
| **LLM call** | `claude -p` with `--allowedTools` for agent-style tool access | No API billing; the agent reads staged data via Read tool and writes report + memory via Write tool |
| **Data aggregation (HN, Dev.to)** | Public [RSSHub](https://github.com/DIYgod/RSSHub) instance at `rsshub.pseudoyu.com` | Community-maintained, covers hundreds of sources, no self-hosting |
| **AI analysis** | Claude Opus 4.6 via `claude -p` | Best quality for senior-analyst synthesis; Max subscription covers usage |
| **Static site build** | [11ty](https://github.com/11ty/eleventy) | Mature, fast, JS-native, perfect for daily content |
| **Schema validation** | [Zod](https://github.com/colinhacks/zod) | TypeScript-first, the standard |
| **Linting + formatting** | [Biome](https://github.com/biomejs/biome) | Replaces ESLint+Prettier with one fast tool |
| **Testing** | [Vitest](https://github.com/vitest-dev/vitest) | Modern, fast, ESM-native |
| **Deploy** | [actions/deploy-pages](https://github.com/actions/deploy-pages) | Official GitHub Pages OIDC deploy |
| **HTML scraping** | [cheerio](https://github.com/cheeriojs/cheerio) | Used in `github-trending.js` instead of regex |
| **GitHub API** | [Octokit](https://github.com/octokit/octokit.js) | Bundles retry + throttling plugins by default |
| **Self-maintained** | Agent prompt · 11ty templates · CSS theme · Zod schemas · `collect.js` + `analyze.sh` orchestration | The IP that makes this differentiated |

## License

MIT — see [LICENSE](./LICENSE).
