#!/usr/bin/env node
// Verify docs/data-sources.md is in sync with config.json.
//
// Extracts every source name + topic from config.json (including lens overlays)
// and grep-checks that each appears somewhere in docs/data-sources.md. Reports
// the names found in config but missing from the doc, then exits non-zero so CI
// or pre-commit can catch drift.
//
// Usage:
//   node scripts/check-data-sources.mjs
//   npm run check:sources

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const config = JSON.parse(readFileSync(resolve(root, 'config.json'), 'utf8'));
const doc = readFileSync(resolve(root, 'docs/data-sources.md'), 'utf8');

const expected = [];

for (const feed of config.sources?.feeds ?? []) {
  expected.push({ kind: 'feed', name: feed.name });
}
for (const topic of config.sources?.github_topics?.topics ?? []) {
  expected.push({ kind: 'topic', name: topic });
}
for (const region of config.sources?.github_developers?.regions ?? []) {
  expected.push({ kind: 'dev-region', name: region.name });
}

for (const lens of config.lenses ?? []) {
  const overlay = lens.sources_overlay ?? {};
  for (const feed of overlay.feeds ?? []) {
    expected.push({ kind: `lens(${lens.id}) feed`, name: feed.name });
  }
  for (const topic of overlay.github_topics?.topics ?? []) {
    expected.push({ kind: `lens(${lens.id}) topic`, name: topic });
  }
}

const missing = expected.filter(({ name }) => !doc.includes(name));

if (missing.length === 0) {
  console.log(
    `OK — all ${expected.length} sources from config.json present in docs/data-sources.md`,
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
