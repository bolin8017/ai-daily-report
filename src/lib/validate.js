#!/usr/bin/env node
// Validates a JSON file against a Zod schema. Used as a quality gate in run.sh.
//
// Usage: node src/lib/validate.js <kind> <path>
//   kind: config | report | feed-output
//
// Exits 0 on success, 1 on failure (prints error details to stderr).

import { readFileSync } from 'node:fs';
import { ConfigSchema } from '../schemas/config.js';
import { FetchOutputSchema } from '../schemas/feed-item.js';
import { resolveReportSchema } from '../schemas/report.js';

// `report` is intentionally absent here: it is validated against the *dynamic*,
// theme-composed schema (resolveReportSchema), the same one scripts/merge uses.
// A hard-coded static report schema silently drifted from the active theme's
// sections — the 新發現 cutover dropped `shipped` / added `discoveries`, but the
// static schema still required `shipped`, so every post-cutover report failed
// this gate (CI deploy + Hermes production runner). Resolving dynamically keeps
// the gate in lockstep with the theme that actually composed the report.
const SCHEMAS = {
  config: ConfigSchema,
  'feed-output': FetchOutputSchema,
};

const KINDS = ['config', 'report', 'feed-output'];

const [, , kind, path] = process.argv;

if (!kind || !path) {
  console.error('Usage: node src/lib/validate.js <config|report|feed-output> <path>');
  process.exit(1);
}

if (!KINDS.includes(kind)) {
  console.error(`Unknown schema: ${kind}. Choose from: ${KINDS.join(', ')}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`✗ Failed to read/parse ${path}: ${err.message}`);
  process.exit(1);
}

// v1.x reports (pre-2026-05-22 IA redesign) lack `schema_version` and have
// a different top-level shape (signals as array, no ideation/market/tech
// sections). They predate the strict v2 schema; templates render them via
// the legacy partial routed by schema_version. Skip them in CI so older
// archived reports don't break the validation gate when a v2 schema lands.
//
// Use `>= 2` (not `=== 2`): v2.0 reports carry schema_version 2 and v2.1
// (post-2026-05-24 editorial/merge split) carry 2.1 — both render via the v2
// unified partial and MUST be validated. A bare `!== 2` check silently
// skipped every 2.1 report, turning this validation gate into a no-op.
if (kind === 'report' && !(data.schema_version >= 2)) {
  console.error(
    `↷ ${path} is a v1.x legacy report (schema_version < 2) — skipping v2 schema validation`,
  );
  process.exit(0);
}

// Report uses the dynamic theme-composed schema; everything else is static.
const schema = kind === 'report' ? await resolveReportSchema() : SCHEMAS[kind];

const result = schema.safeParse(data);
if (!result.success) {
  console.error(`✗ ${path} failed ${kind} schema validation:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

console.error(`✓ ${path} passes ${kind} schema`);
