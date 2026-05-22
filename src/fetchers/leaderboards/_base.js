// Shared helpers for leaderboard adapters: snapshot diff, common fetch wrappers,
// per-bench cache path. Each adapter writes a snapshot to CACHE_DIR/<bench>.json
// and diffs against the previous snapshot to produce surface-worthy events.

import { mkdir, readFile, writeFile } from 'node:fs/promises';

const CACHE_DIR = 'data/staging/leaderboards/.cache';

export async function loadPrevSnapshot(bench) {
  try {
    const raw = await readFile(`${CACHE_DIR}/${bench}.json`, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveSnapshot(bench, snapshot) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(`${CACHE_DIR}/${bench}.json`, JSON.stringify(snapshot, null, 2));
}

/**
 * Compute diff between previous and current leaderboard snapshots.
 *
 * @param {Array<{model_id: string, rank: number, score: number}> | null} prev
 * @param {Array<{model_id: string, rank: number, score: number}>} curr
 * @returns {{ new_top_5: string[], rank_changes: string[], top_5_today: string[] }}
 */
export function diffSnapshots(prev, curr) {
  const top5 = curr.slice(0, 5).map((e) => e.model_id);

  if (!prev || !Array.isArray(prev) || prev.length === 0) {
    return { new_top_5: top5, rank_changes: [], top_5_today: top5 };
  }

  const prevById = new Map(prev.map((e) => [e.model_id, e.rank]));

  const new_top_5 = top5.filter((m) => {
    const prevRank = prevById.get(m);
    return prevRank === undefined || prevRank > 5;
  });

  const rank_changes = [];
  for (const e of curr.slice(0, 10)) {
    const prevRank = prevById.get(e.model_id);
    if (prevRank !== undefined && prevRank !== e.rank) {
      const dir = e.rank < prevRank ? '↑' : '↓';
      rank_changes.push(`${e.model_id}: #${prevRank} → #${e.rank} ${dir}`);
    }
  }
  return { new_top_5, rank_changes, top_5_today: top5 };
}

export async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'ai-daily-report/1.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.text();
}

export async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}
