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

const result = schema.safeParse(data);
if (!result.success) {
  console.error(`✗ ${path} failed ${kind} schema validation:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

console.error(`✓ ${path} passes ${kind} schema`);
