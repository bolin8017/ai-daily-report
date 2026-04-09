// Parallel runner for all 4 fetchers. Used by src/pipeline.js.
//
// Returns `{ feeds, trending, search, developers }`, each with the envelope
// shape `{ ok, items, ...meta }`. A single fetcher failure is tolerated; the
// pipeline aborts only if fewer than 3 of 4 fetchers are healthy.

import { fetchFeeds } from './feeds.js';
import { fetchDevelopers } from './github-developers.js';
import { fetchSearch } from './github-search.js';
import { fetchTrending } from './github-trending.js';

const FETCHERS = [
  { key: 'feeds', fn: fetchFeeds },
  { key: 'trending', fn: fetchTrending },
  { key: 'search', fn: fetchSearch },
  { key: 'developers', fn: fetchDevelopers },
];

const MIN_HEALTHY = 3;

function unwrap(settled, name) {
  if (settled.status === 'rejected') {
    const msg = settled.reason?.message ?? String(settled.reason);
    console.error(`[fetchers/all] ${name} rejected: ${msg}`);
    return { ok: false, items: [], error: msg };
  }
  return settled.value;
}

export async function runFetchers() {
  const t0 = Date.now();
  const settled = await Promise.allSettled(FETCHERS.map((f) => f.fn()));

  const result = {};
  const healthy = [];
  const degraded = [];
  for (let i = 0; i < FETCHERS.length; i++) {
    const { key } = FETCHERS[i];
    const value = unwrap(settled[i], key);
    result[key] = value;
    const isHealthy = value.ok && (value.items?.length ?? 0) > 0;
    (isHealthy ? healthy : degraded).push(key);
  }

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(
    `[fetchers/all] ${healthy.length}/${FETCHERS.length} healthy in ${elapsedSec}s` +
      (degraded.length ? ` (degraded: ${degraded.join(', ')})` : ''),
  );

  if (healthy.length < MIN_HEALTHY) {
    throw new Error(
      `[fetchers/all] only ${healthy.length}/${FETCHERS.length} fetchers healthy, minimum ${MIN_HEALTHY} required`,
    );
  }

  return result;
}
