// Per-leaderboard ranking snapshot ledger — persists each benchmark's last
// seen ranking so the pipeline can diff today's results against the previous
// run's across days. Lives on the `data` branch (committed by Stage 4).
//
// Shape: { "<bench>": [{ model_id, rank, score, ... }] }
//
// Path is parameterised so tests never touch the real file.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWriteFileSync } from './fs-atomic.js';

export const DEFAULT_SNAPSHOTS_PATH = 'data/leaderboard-snapshots.json';

export function loadSnapshots(path = DEFAULT_SNAPSHOTS_PATH) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`[leaderboard-snapshots] file unreadable (${err.message}) — treating as empty`);
    return {};
  }
}

export function getPrev(bench, path = DEFAULT_SNAPSHOTS_PATH) {
  const all = loadSnapshots(path);
  return Array.isArray(all[bench]) ? all[bench] : null;
}

export function saveSnapshot(bench, ranking, path = DEFAULT_SNAPSHOTS_PATH) {
  let all = {};
  if (existsSync(path)) {
    try {
      all = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      // Rebuilding from {} here would wipe every other board's baseline and
      // make each one re-emit a spurious cold-start item next diff. Losing
      // one day's snapshot for this bench is the cheaper failure.
      console.error(
        `[leaderboard-snapshots] existing ledger unreadable (${err.message}) — refusing to overwrite; ${bench} snapshot not persisted`,
      );
      return false;
    }
  }
  all[bench] = ranking;
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return true;
}
