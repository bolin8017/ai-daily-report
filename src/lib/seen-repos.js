// Cross-day dedup ledger for the catalog-walk ("精選") section. Records which
// 30k+ repos have already been shown so each day surfaces only unseen ones.
//
// This is mechanical state (a flat list), not the LLM-memory blob that
// data/memory.json was — it lives on the `data` branch (committed by Stage 4 /
// run.sh) and is read at Stage 1 to exclude seen repos.
//
// Read order in loadSeenLedger: local file (warm single-host cron) → the data
// branch via `git show` (cold CI / fresh host) → []. Path is parameterised so
// tests never touch the real file or invoke git.

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

/**
 * Load the ledger array. Local file first, then the data branch, then [].
 * @param {string} [ledgerPath]
 * @returns {Array<{repo:string, first_shown:string, stars_at_show:number}>}
 */
export function loadSeenLedger(ledgerPath = DEFAULT_LEDGER_PATH) {
  if (existsSync(ledgerPath)) {
    try {
      return SeenReposSchema.parse(JSON.parse(readFileSync(ledgerPath, 'utf8')));
    } catch (err) {
      console.error(`[seen-repos] local ledger unreadable (${err.message}) — trying data branch`);
    }
  }
  try {
    const raw = execFileSync('git', ['show', `${DATA_BRANCH_REF}:${ledgerPath}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return SeenReposSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * @param {string} [ledgerPath]
 * @param {{shownBefore?: string}} [opts] - when set, entries first shown on or
 *   after this YYYY-MM-DD date are excluded. A completed day's full re-run
 *   passes today here so the ledger entries Stage 4 appended for today don't
 *   filter today's own picks out of the candidate pool — that silently
 *   emptied the regenerated report's discoveries sections.
 * @returns {Set<string>} set of "owner/name"
 */
export function loadSeenSet(ledgerPath = DEFAULT_LEDGER_PATH, { shownBefore } = {}) {
  const entries = loadSeenLedger(ledgerPath);
  const kept = shownBefore ? entries.filter((e) => e.first_shown < shownBefore) : entries;
  return new Set(kept.map((e) => e.repo));
}

/**
 * Append newly-shown repos to the ledger, idempotent on `repo`. Writes the file
 * only when something was added. Committing it is the caller's job.
 * @param {Array<{repo?:string, full_name?:string, stars?:number}>} repos
 * @param {string} date  YYYY-MM-DD
 * @param {string} [ledgerPath]
 * @returns {{added:number, total:number}}
 */
export function appendSeen(repos, date, ledgerPath = DEFAULT_LEDGER_PATH) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`[seen-repos] appendSeen: date must be YYYY-MM-DD, got "${date}"`);
  }
  const ledger = loadSeenLedger(ledgerPath);
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
