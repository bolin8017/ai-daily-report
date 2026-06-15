// Per-leaderboard ranking snapshot ledger — persists each benchmark's last
// seen ranking so the pipeline can diff today's results against the previous
// run's across days. Lives on the `data` branch (committed by Stage 4).
//
// Shape: { "<bench>": [{ model_id, rank, score, ... }] }
//
// Path is parameterised so tests never touch the real file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

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
  const all = loadSnapshots(path);
  all[bench] = ranking;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
}
