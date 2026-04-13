# Contributing

This is a personal project. PRs are not actively reviewed, but issues and suggestions are welcome.

## Setup

```bash
git clone https://github.com/bolin8017/ai-daily-report.git
cd ai-daily-report
npm ci
cp .env.example .env  # set GITHUB_TOKEN
```

## Development

```bash
npm start              # Stage 1 only (fetch + condense, no LLM)
npm run serve          # 11ty dev server with live reload
npm test               # Vitest schema tests
npm run lint           # Biome check
npm run format         # Biome format --write
npm run validate:report  # Validate latest report against schema
```

## Iterating on the agent prompt

The agent prompt (`.claude/agents/daily-report.md`) is the primary quality lever. To iterate without running the full pipeline:

```bash
# 1. Run Stage 1 to get fresh staging data
npm start

# 2. Edit .claude/agents/daily-report.md or .claude/daily-report-quality.md

# 3. Run Stage 2 only against existing staging data (no push)
SKIP_PUSH=1 bash scripts/run.sh --analyze

# 4. Validate output
npm run validate:report
```

## Conventions

- **Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `chore:`
- **Schema-first**: change `src/schemas/` → agent prompt → templates (in that order)
- **Lint before push**: `npm test && npm run lint`

## Adding a data source

1. Add an entry to `config.json` under `sources.feeds[]`
2. Test: `node src/fetchers/feeds.js | jq '.feeds_ok'`
3. Run `npm start` to verify end-to-end
4. If it's a new category, update the **Inputs** section of `.claude/agents/daily-report.md`

## Architecture

See [docs/architecture.md](./docs/architecture.md) for design decisions and trade-offs.
