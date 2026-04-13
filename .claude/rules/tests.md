---
paths:
  - "tests/**/*.js"
---

# Test conventions

## Framework

- Vitest (ESM-native). Run with `npm test` (maps to `vitest run`)
- Import test utilities from `vitest`: `describe`, `it`, `expect`

## Patterns observed in this codebase

- `it.skipIf(!condition)` for tests that depend on data files that may not exist (e.g., report fixtures, memory.json, staging data)
- Schema smoke tests validate real committed fixtures against Zod schemas, not synthetic data
- `condense.test.js` uses mock factories (`mockFeeds`, `mockGithub`) to test budget-sensitive logic without network calls
- No mocking of external services -- fetcher tests are integration tests run manually; unit tests focus on schemas and pure transform functions

## When adding tests

- Place in `tests/` (flat, no subdirectories currently)
- Name as `<module>.test.js`
- For schema changes: add or update fixtures in the corresponding `describe` block in `schemas.test.js`
- For new fetchers: add mock factory + condensation tests in a new file, following `condense.test.js` patterns
