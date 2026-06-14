// Per-repo daily star/fork snapshot ledger — the velocity backbone for the
// 新發現 tab. Lives on the `data` branch (committed by Stage 4 / run.sh),
// written by Stage 1 from numbers already in the fetched payloads (zero extra
// API). Phase 1 only accrues the series; Phase 2 computes velocity from it.
//
// Shape: { "owner/repo": { first_seen: "YYYY-MM-DD",
//          snapshots: [{ date, stars, forks }] } }
//
// Read order mirrors seen-repos.js: local file → data branch via `git show`
// → {}. Path is parameterised so tests never touch the real file or git.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalRepoKey } from './repo-key.js';

export const DEFAULT_HISTORY_PATH = 'data/star-history.json';
const DATA_BRANCH_REF = 'refs/remotes/origin/data';
const RETENTION_DAYS = 30;

export function loadStarHistory(historyPath = DEFAULT_HISTORY_PATH) {
  if (existsSync(historyPath)) {
    try {
      return JSON.parse(readFileSync(historyPath, 'utf8'));
    } catch (err) {
      console.error(`[star-history] local file unreadable (${err.message}) — trying data branch`);
    }
  }
  try {
    const raw = execFileSync('git', ['show', `${DATA_BRANCH_REF}:${historyPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/**
 * Drop snapshots older than `days` and any repo left with none. Returns a new
 * object; the input is not mutated.
 */
export function pruneStarHistory(history, today, days = RETENTION_DAYS) {
  const out = {};
  for (const [repo, rec] of Object.entries(history ?? {})) {
    const snapshots = (rec.snapshots ?? []).filter((s) => daysBetween(s.date, today) <= days);
    if (snapshots.length > 0) out[repo] = { ...rec, snapshots };
  }
  return out;
}

/**
 * Record today's {stars, forks} for each item that has a derivable owner/repo
 * and a numeric star count. Idempotent on (repo, date). Prunes before writing.
 * @returns {{recorded:number, repos:number}}
 */
export function recordSnapshot(items, date, historyPath = DEFAULT_HISTORY_PATH) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[star-history] recordSnapshot: date must be YYYY-MM-DD, got "${date}"`);
  }
  const history = loadStarHistory(historyPath);
  let recorded = 0;
  for (const item of items ?? []) {
    const repo = canonicalRepoKey(item);
    if (!repo) continue;
    const stars = Number.isFinite(item?.stars) ? item.stars : null;
    if (stars === null) continue;
    const forks = Number.isFinite(item?.forks) ? item.forks : null;
    if (!history[repo]) history[repo] = { first_seen: date, snapshots: [] };
    const rec = history[repo];
    const existing = rec.snapshots.find((s) => s.date === date);
    if (existing) {
      existing.stars = stars;
      existing.forks = forks;
    } else {
      rec.snapshots.push({ date, stars, forks });
    }
    recorded++;
  }
  const pruned = pruneStarHistory(history, date);
  writeFileSync(historyPath, `${JSON.stringify(pruned, null, 2)}\n`);
  return { recorded, repos: Object.keys(pruned).length };
}
