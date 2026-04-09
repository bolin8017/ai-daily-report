// Shared helper that lets each fetcher double as:
//   1. An importable async function (returns the result object) — used by
//      src/fetchers/all.js and tests.
//   2. A standalone CLI script that writes JSON to stdout and sets exit code
//      based on the `ok` field — preserved so `node src/fetchers/feeds.js`
//      still works for debugging.
//
// Rule: the fetcher's own function never calls `process.stdout.write` or
// `process.exit`. Those concerns live here, gated on whether the file is the
// entry point.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function isEntryPoint(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}

export function runAsStandalone(importMetaUrl, fn) {
  if (!isEntryPoint(importMetaUrl)) return;

  fn().then(
    (result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result?.ok === false ? 1 : 0);
    },
    (err) => {
      console.error(err.stack ?? err.message ?? String(err));
      process.stdout.write(
        `${JSON.stringify({ ok: false, items: [], error: err.message ?? String(err) })}\n`,
      );
      process.exit(1);
    },
  );
}
