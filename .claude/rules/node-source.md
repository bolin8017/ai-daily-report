---
paths:
  - "src/**/*.js"
  - "eleventy.config.js"
---

# Node.js source conventions

## Module system

- ESM only (`"type": "module"` in package.json). Use `import`/`export`, never `require()`
- `__dirname` equivalent: `path.dirname(fileURLToPath(import.meta.url))`
- Node built-ins use the `node:` prefix: `import fs from 'node:fs'`

## Formatting (Biome)

- 2-space indent, single quotes, semicolons always, trailing commas
- Line width 100 (see `biome.json`)
- Run `npm run lint` / `npm run format` before committing JS changes

## Fetcher dual-mode pattern

Every file in `src/fetchers/` is both importable and a standalone CLI:

1. Export a named async function (e.g., `fetchTrending`)
2. At the bottom, call `runAsStandalone(import.meta.url, fn)` from `_dispatch.js`
3. The fetcher function itself never calls `process.stdout.write` or `process.exit`
4. Return envelope shape: `{ ok: boolean, items: Array, ...meta }`

When adding a new provider, register it with `src/fetchers/providers/_registry.js` and add a side-effect import in `src/collect.js`; `src/fetchers/run-all.js` runs the registered chains in parallel.

## Condense dual-mode pattern

`src/lib/condense.js` exports `condenseAll()` for in-process use and detects `isMain` for standalone file-in/file-out mode. Same separation: the export never touches `process`.

## Error handling

- Top-level `main().catch(...)` with `process.exit(1)` in entry scripts (collect.js)
- Fetchers: individual failures are `{ ok: false, items: [], error: msg }`, not thrown
- `runAll()` tolerates a fraction of sources failing — `src/collect.js` passes `minHealthy: Math.ceil(sources.length / 3)`; failures are recorded in `metadata.degraded`

## Schema-first development

When changing data shapes:
1. Update the Zod schema in `src/schemas/` first
2. Update the prompts under `themes/<ACTIVE_THEME>/` (`synthesizer.md`, `sections/<id>/curator.md`) if the field is agent-produced
3. Update 11ty templates (`site/_includes/`) if the field is rendered
4. Run `npm test` to verify schema fixtures still pass
