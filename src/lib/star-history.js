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
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFileSync } from './fs-atomic.js';
import { canonicalRepoKey } from './repo-key.js';

export const DEFAULT_HISTORY_PATH = 'data/star-history.json';
const DATA_BRANCH_REF = 'refs/remotes/origin/data';
const RETENTION_DAYS = 30;

export const StarSnapshot = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stars: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative().nullable().optional(),
});
export const StarHistorySchema = z.record(
  z
    .object({
      first_seen: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      watch_since: z.string().optional(),
      snapshots: z.array(StarSnapshot),
    })
    .passthrough(),
);

// Reads the ledger from the data branch. Returns { status: 'ok', raw } |
// { status: 'absent' } (ref exists, no ledger in it — a genuine cold start) |
// { status: 'error', detail } (ref missing or git failed — the prior state is
// unknowable, NOT known-empty; a stale clone without the fetched data branch
// lands here).
function gitShowBranchFile(historyPath) {
  try {
    const raw = execFileSync('git', ['show', `${DATA_BRANCH_REF}:${historyPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 'ok', raw };
  } catch (err) {
    const stderr = err?.stderr?.toString?.() ?? '';
    if (/does not exist in|exists on disk, but not in/.test(stderr)) return { status: 'absent' };
    return { status: 'error', detail: stderr.trim() || err.message };
  }
}

// provenance: 'local' | 'branch' — a real ledger loaded; 'absent' — no ledger
// exists anywhere (safe to start fresh); 'unavailable' — prior state exists
// (or may exist) but could not be read — overwriting would destroy it.
function loadStarHistoryWithProvenance(historyPath, branchRead) {
  const localExists = existsSync(historyPath);
  if (localExists) {
    try {
      const parsed = JSON.parse(readFileSync(historyPath, 'utf8'));
      const guarded = StarHistorySchema.safeParse(parsed);
      if (guarded.success) return { history: guarded.data, provenance: 'local' };
      console.error(
        `[star-history] local file failed schema validation — trying data branch (${guarded.error.issues[0]?.message ?? 'invalid shape'})`,
      );
    } catch (err) {
      console.error(`[star-history] local file unreadable (${err.message}) — trying data branch`);
    }
  }
  const br = branchRead(historyPath);
  if (br.status === 'ok') {
    try {
      const guarded = StarHistorySchema.safeParse(JSON.parse(br.raw));
      if (guarded.success) return { history: guarded.data, provenance: 'branch' };
      console.error('[star-history] data-branch file failed schema validation');
    } catch (err) {
      console.error(`[star-history] data-branch file unreadable (${err.message})`);
    }
    return { history: {}, provenance: 'unavailable' };
  }
  if (br.status === 'error') {
    console.error(`[star-history] data-branch read failed (${br.detail})`);
    return { history: {}, provenance: 'unavailable' };
  }
  // branch says absent: only a cold start if no local file existed either
  return { history: {}, provenance: localExists ? 'unavailable' : 'absent' };
}

export function loadStarHistory(historyPath = DEFAULT_HISTORY_PATH) {
  return loadStarHistoryWithProvenance(historyPath, gitShowBranchFile).history;
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
export function recordSnapshot(
  items,
  date,
  historyPath = DEFAULT_HISTORY_PATH,
  { branchRead = gitShowBranchFile } = {},
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[star-history] recordSnapshot: date must be YYYY-MM-DD, got "${date}"`);
  }
  const { history, provenance } = loadStarHistoryWithProvenance(historyPath, branchRead);
  if (provenance === 'unavailable') {
    // Writing a today-only ledger here would get committed by Stage 4 and
    // destroy up to RETENTION_DAYS of accrued velocity series. Skipping loses
    // one day of snapshots — the far cheaper side of the asymmetry.
    console.error(
      '[star-history] prior ledger could not be read — refusing to start fresh. ' +
        'Restore the file or `git fetch origin data`, then re-run.',
    );
    return { recorded: 0, repos: 0, skipped: true };
  }
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
  atomicWriteFileSync(historyPath, `${JSON.stringify(pruned, null, 2)}\n`);
  return { recorded, repos: Object.keys(pruned).length };
}
