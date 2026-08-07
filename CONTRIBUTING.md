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
npm test               # Vitest unit tests
npm run lint           # Biome check
npm run format         # Biome format --write
npm run check:sources  # Verify docs/data-sources.md matches the theme's sources.yaml
npm run validate:report  # Validate latest report against schema
```

## Iterating on the agent prompts

The active theme's prompts are the primary quality lever: `themes/ai-builder/synthesizer.md`
(persona / voice) with `themes/ai-builder/quality.md` (anti-slop rules), plus the
per-section curator prompts at `themes/ai-builder/sections/<id>/curator.md`. To
iterate without running the full pipeline:

```bash
# 1. Run Stage 1 to get fresh staging data
npm start

# 2. Edit themes/ai-builder/synthesizer.md, themes/ai-builder/quality.md,
#    or themes/ai-builder/sections/<id>/curator.md

# 3. Run Stages 2-4 against existing staging data (no push)
SKIP_PUSH=1 bash scripts/run.sh --analyze

# 4. Validate output
npm run validate:report
```

## Conventions

- **Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `chore:`
- **Schema-first**: change the section's `themes/<theme>/sections/<id>/schema.js` → its
  `curator.md` prompt → its `partial.njk` (in that order)
- **Lint before push**: `npm test && npm run lint`

## Adding a data source

`config.json` is an empty placeholder validated with `.strict()` — adding anything to it
aborts the pipeline at startup. Source configuration lives in the registry and the theme.

1. Add the source to `src/sources/registry.js` (base list), or to
   `themes/<theme>/sources.yaml` under `phison_overlay` if it is theme-specific
2. If it is a native-RSS feed, regenerate the Miniflux feed list and provision it:
   `node scripts/gen-feeds-opml.mjs && node scripts/miniflux-sync.mjs`
3. Document it in `docs/data-sources.md`, then confirm the two agree: `npm run check:sources`
4. Run `npm start` to verify end-to-end

## Architecture

See [docs/architecture.md](./docs/architecture.md) for design decisions and trade-offs.
