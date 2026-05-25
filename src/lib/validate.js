#!/usr/bin/env node
// Validates a JSON file against a Zod schema. Used as a quality gate in run.sh.
//
// Usage: node src/lib/validate.js <kind> <path>
//   kind: config | report | memory | feed-output
//
// Exits 0 on success, 1 on failure (prints error details to stderr).

import { readFileSync } from 'node:fs';
import { ConfigSchema } from '../schemas/config.js';
import { FetchOutputSchema } from '../schemas/feed-item.js';
import { MemorySchema } from '../schemas/memory.js';
import { ReportSchema } from '../schemas/report.js';

const SCHEMAS = {
  config: ConfigSchema,
  report: ReportSchema,
  memory: MemorySchema,
  'feed-output': FetchOutputSchema,
};

const [, , kind, path] = process.argv;

if (!kind || !path) {
  console.error('Usage: node src/lib/validate.js <config|report|memory|feed-output> <path>');
  process.exit(1);
}

const schema = SCHEMAS[kind];
if (!schema) {
  console.error(`Unknown schema: ${kind}. Choose from: ${Object.keys(SCHEMAS).join(', ')}`);
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

const result = schema.safeParse(data);
if (!result.success) {
  console.error(`✗ ${path} failed ${kind} schema validation:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

console.error(`✓ ${path} passes ${kind} schema`);
