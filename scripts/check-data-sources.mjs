#!/usr/bin/env node
// Verify docs/data-sources.md is in sync with the active theme's sources.yaml.
//
// Extracts every source / topic / overlay entry from
// themes/$ACTIVE_THEME/sources.yaml and grep-checks that each appears somewhere
// in docs/data-sources.md. Reports drift and exits non-zero so CI or
// pre-commit can catch it.
//
// Usage:
//   node scripts/check-data-sources.mjs
//   npm run check:sources

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const ACTIVE_THEME = process.env.ACTIVE_THEME || 'ai-builder';

const themeSourcesPath = resolve(root, 'themes', ACTIVE_THEME, 'sources.yaml');
const sources = YAML.parse(readFileSync(themeSourcesPath, 'utf8'));
const doc = readFileSync(resolve(root, 'docs/data-sources.md'), 'utf8');

const expected = [];

// Dev-watch regions
for (const region of sources.github_developers?.regions ?? []) {
  expected.push({ kind: 'dev-region', name: region.name });
}

// Phison overlay sources + topics (theme-specific)
const overlay = sources.phison_overlay ?? {};
for (const src of overlay.sources ?? []) {
  expected.push({ kind: `overlay source`, name: src.label ?? src.id });
}
for (const topic of overlay.github_topics?.topics ?? []) {
  expected.push({ kind: `overlay topic`, name: topic });
}

const missing = expected.filter(({ name }) => !doc.includes(name));

if (missing.length === 0) {
  console.log(
    `OK — all ${expected.length} sources from themes/${ACTIVE_THEME}/sources.yaml present in docs/data-sources.md`,
  );
  process.exit(0);
}

console.error(
  `DRIFT — ${missing.length} of ${expected.length} sources missing from docs/data-sources.md:`,
);
for (const { kind, name } of missing) {
  console.error(`  - [${kind}] ${name}`);
}
console.error('\nUpdate docs/data-sources.md, then bump the "Last verified" line at the top.');
process.exit(1);
