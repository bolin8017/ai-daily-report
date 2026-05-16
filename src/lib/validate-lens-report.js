#!/usr/bin/env node
// Validates a per-lens report JSON file against the schema registered for
// its lens_id. Used as the Stage 2 quality gate for non-default lenses.
//
// Usage: node src/lib/validate-lens-report.js <path> <lens-id>
//
// Exits:
//   0 — schema validation passes
//   1 — file missing, JSON parse failure, or schema validation failure
//   2 — usage error (missing args)

import { existsSync, readFileSync } from 'node:fs';
import { PhisonLensReportSchema } from '../schemas/lens-report.js';

const VALIDATORS = {
  'phison-aidaptiv': PhisonLensReportSchema,
  // Add new lens schemas here as new lenses are introduced.
};

const [, , path, lensId] = process.argv;

if (!path || !lensId) {
  console.error('Usage: node src/lib/validate-lens-report.js <path> <lens-id>');
  process.exit(2);
}

if (!existsSync(path)) {
  console.error(`✗ file not found: ${path}`);
  process.exit(1);
}

const schema = VALIDATORS[lensId];
if (!schema) {
  console.error(`✗ no validator registered for lens_id: ${lensId}`);
  console.error(`  available: ${Object.keys(VALIDATORS).join(', ')}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`✗ failed to read/parse ${path}: ${err.message}`);
  process.exit(1);
}

const result = schema.safeParse(data);
if (!result.success) {
  console.error(`✗ ${path} failed ${lensId} lens schema validation:`);
  for (const issue of result.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

console.error(`✓ ${path} passes ${lensId} lens schema`);
