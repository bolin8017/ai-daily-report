import { getProvider } from './providers/_registry.js';

export async function runChain(source, ctx = {}) {
  const telemetry = ctx.telemetry ?? { record: () => {} };
  const threshold = source.threshold ?? 1;

  for (let i = 0; i < source.chain.length; i++) {
    const entry = source.chain[i];
    const t0 = Date.now();
    let result;
    try {
      const provider = getProvider(entry.provider);
      result = await provider(entry.config ?? {}, {
        itemType: source.itemType,
        sourceId: source.id,
        quota: ctx.quota,
      });
    } catch (err) {
      result = { ok: false, items: [], error: err.message };
    }
    const latency_ms = Date.now() - t0;

    telemetry.record({
      source_id: source.id,
      tier_index: i,
      provider: entry.provider,
      ok: result.ok,
      items: result.items?.length ?? 0,
      latency_ms,
      error: result.error,
    });

    if (result.ok && (result.items?.length ?? 0) >= threshold) {
      if (i > 0) {
        console.error(`[chain] ${source.id} recovered at tier ${i} (${entry.provider})`);
      }
      return { ok: true, items: result.items, tier_used: i, meta: result.meta };
    }
  }

  console.error(`[chain] ${source.id} exhausted all ${source.chain.length} tiers`);
  return { ok: false, items: [], tier_used: -1 };
}
