// Cross-day dedup ledger for the 新發現 (discoveries) section. Records which
// repos have already been shown so each day surfaces only unseen ones.
//
// This is mechanical state (a flat list), not the LLM-memory blob that
// data/memory.json was — it lives on the `data` branch (committed by Stage 4 /
// run.sh) and is read at Stage 1 to exclude seen repos.
//
// Read order: local file (warm single-host cron) → the data branch via
// `git show` (cold CI / fresh host) → empty. Because Stage 4 commits this file
// every run, "empty" must never be inferred from a *failed* read: appendSeen
// distinguishes a genuine cold start (no ledger anywhere) from unknowable prior
// state and refuses to write in the latter case, exactly as star-history.js
// does. Path and the branch reader are parameterised so tests never touch the
// real file or invoke git.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { atomicWriteFileSync } from './fs-atomic.js';

export const DEFAULT_LEDGER_PATH = 'data/seen-repos.json';
const DATA_BRANCH_REF = 'refs/remotes/origin/data';

export const SeenRepoEntry = z.object({
  repo: z.string(),
  first_shown: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  stars_at_show: z.number().int().nonnegative(),
});
export const SeenReposSchema = z.array(SeenRepoEntry);

// Reads the ledger from the data branch. Returns { status: 'ok', raw } |
// { status: 'absent' } (ref exists, no ledger in it — a genuine cold start) |
// { status: 'error', detail } (ref missing or git failed — the prior state is
// unknowable, NOT known-empty; a fresh clone without the fetched data branch
// lands here). Mirrors star-history.js's reader.
function gitShowBranchFile(ledgerPath) {
  try {
    const raw = execFileSync('git', ['show', `${DATA_BRANCH_REF}:${ledgerPath}`], {
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
function loadSeenLedgerWithProvenance(ledgerPath, branchRead) {
  const localExists = existsSync(ledgerPath);
  if (localExists) {
    try {
      const ledger = SeenReposSchema.parse(JSON.parse(readFileSync(ledgerPath, 'utf8')));
      return { ledger, provenance: 'local' };
    } catch (err) {
      console.error(`[seen-repos] local ledger unreadable (${err.message}) — trying data branch`);
    }
  }
  const br = branchRead(ledgerPath);
  if (br.status === 'ok') {
    try {
      return { ledger: SeenReposSchema.parse(JSON.parse(br.raw)), provenance: 'branch' };
    } catch (err) {
      console.error(`[seen-repos] data-branch ledger unreadable (${err.message})`);
    }
    return { ledger: [], provenance: 'unavailable' };
  }
  if (br.status === 'error') {
    console.error(`[seen-repos] data-branch read failed (${br.detail})`);
    return { ledger: [], provenance: 'unavailable' };
  }
  // branch says absent: only a cold start if no local file existed either
  return { ledger: [], provenance: localExists ? 'unavailable' : 'absent' };
}

/**
 * Load the ledger array. Local file first, then the data branch, then [].
 * An empty result may mean "nothing shown yet" OR "could not read" — callers
 * that WRITE must use appendSeen, which refuses on the latter.
 * @param {string} [ledgerPath]
 * @param {{branchRead?: function}} [opts]
 * @returns {Array<{repo:string, first_shown:string, stars_at_show:number}>}
 */
export function loadSeenLedger(ledgerPath = DEFAULT_LEDGER_PATH, { branchRead } = {}) {
  return loadSeenLedgerWithProvenance(ledgerPath, branchRead ?? gitShowBranchFile).ledger;
}

/**
 * @param {string} [ledgerPath]
 * @param {{shownBefore?: string, branchRead?: function}} [opts] - shownBefore:
 *   when set, entries first shown on or after this YYYY-MM-DD date are
 *   excluded. A completed day's full re-run passes today here so the ledger
 *   entries Stage 4 appended for today don't filter today's own picks out of
 *   the candidate pool — that silently emptied the regenerated report's
 *   discoveries sections.
 * @returns {Set<string>} set of "owner/name"
 */
export function loadSeenSet(ledgerPath = DEFAULT_LEDGER_PATH, { shownBefore, branchRead } = {}) {
  const entries = loadSeenLedger(ledgerPath, { branchRead });
  const kept = shownBefore ? entries.filter((e) => e.first_shown < shownBefore) : entries;
  return new Set(kept.map((e) => e.repo));
}

/**
 * Append newly-shown repos to the ledger, idempotent on `repo`. Writes the file
 * only when something was added. Committing it is the caller's job.
 *
 * Refuses to write when the prior ledger could not be read (`skipped: true`):
 * Stage 4 commits this file every run, so rebuilding from an assumed-empty
 * ledger would replace the accrued dedup history with a today-only list and the
 * 新發現 tab would start re-surfacing repos it already published. Losing one
 * day's dedup entries is the far cheaper side of that asymmetry.
 *
 * @param {Array<{repo?:string, full_name?:string, stars?:number}>} repos
 * @param {string} date  YYYY-MM-DD
 * @param {string} [ledgerPath]
 * @param {{branchRead?: function}} [opts]
 * @returns {{added:number, total:number, skipped?:boolean}}
 */
export function appendSeen(
  repos,
  date,
  ledgerPath = DEFAULT_LEDGER_PATH,
  { branchRead = gitShowBranchFile } = {},
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[seen-repos] appendSeen: date must be YYYY-MM-DD, got "${date}"`);
  }
  const { ledger, provenance } = loadSeenLedgerWithProvenance(ledgerPath, branchRead);
  if (provenance === 'unavailable') {
    console.error(
      '[seen-repos] prior ledger could not be read — refusing to start fresh. ' +
        'Restore the file or `git fetch origin data`, then re-run.',
    );
    return { added: 0, total: 0, skipped: true };
  }
  const seen = new Set(ledger.map((e) => e.repo));
  let added = 0;
  for (const r of repos ?? []) {
    const key = r.repo ?? r.full_name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ledger.push({ repo: key, first_shown: date, stars_at_show: r.stars ?? 0 });
    added++;
  }
  if (added > 0) atomicWriteFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  return { added, total: ledger.length };
}
