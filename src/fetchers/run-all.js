import { createFirecrawlQuota } from '../lib/quota.js';
import { createTelemetry } from '../lib/telemetry.js';
import { enrichHNAlgolia } from './enrichers/hn-algolia.js';
import { runChain } from './run-chain.js';

const ENRICHERS = {
  'hn-algolia': enrichHNAlgolia,
};

export async function runAll(sources, opts = {}) {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const telemetry = createTelemetry({ outDir: opts.telemetryDir ?? 'data/runs', date });
  const quota = opts.quota ?? createFirecrawlQuota();
  await quota.canSpend(); // initialize snapshot

  const t0 = Date.now();
  const settled = await Promise.allSettled(sources.map((s) => runChain(s, { telemetry, quota })));

  const results = {};
  const healthy = [];
  const degraded = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const settled_i = settled[i];
    let chainResult;
    if (settled_i.status === 'rejected') {
      chainResult = {
        ok: false,
        items: [],
        tier_used: -1,
        error: settled_i.reason?.message,
      };
    } else {
      chainResult = settled_i.value;
    }

    if (chainResult.ok && s.enrich) {
      const enrichers = opts.enrichers ?? ENRICHERS;
      for (const enrichName of s.enrich) {
        const fn = enrichers[enrichName];
        if (!fn) continue;
        // Enrichment is best-effort: a throwing enricher degrades this
        // source's enrichment, never the whole collection run.
        try {
          await fn(chainResult.items);
        } catch (err) {
          console.error(`[run-all] enricher ${enrichName} failed for ${s.id}: ${err.message}`);
        }
      }
    }

    results[s.id] = chainResult;
    (chainResult.ok ? healthy : degraded).push(s.id);
  }

  const quotaSnapshot = await quota.snapshot();
  await telemetry.flush({ quota: { firecrawl: quotaSnapshot } });

  const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.error(
    `[run-all] ${healthy.length}/${sources.length} healthy in ${elapsedSec}s` +
      (degraded.length ? ` (degraded: ${degraded.join(', ')})` : ''),
  );

  const minHealthy = opts.minHealthy ?? Math.ceil(sources.length / 2);
  if (healthy.length < minHealthy) {
    throw new Error(
      `[run-all] only ${healthy.length}/${sources.length} healthy, min ${minHealthy}`,
    );
  }

  return { results, healthy, degraded };
}
