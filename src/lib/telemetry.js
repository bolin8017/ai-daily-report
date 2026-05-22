import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createTelemetry({ outDir = 'data/runs', date }) {
  const startedAt = new Date().toISOString();
  const entries = [];

  return {
    record(entry) {
      entries.push(entry);
    },
    async flush({ quota } = {}) {
      // Aggregate per source_id — final outcome wins (last successful tier, or
      // last failed attempt if none succeeded).
      const bySource = new Map();
      for (const e of entries) {
        const prev = bySource.get(e.source_id);
        if (!prev) {
          bySource.set(e.source_id, e);
          continue;
        }
        if (e.ok && !prev.ok) {
          bySource.set(e.source_id, e);
        } else if (e.ok === prev.ok && e.tier_index > prev.tier_index) {
          bySource.set(e.source_id, e);
        }
      }

      const errorChain = (sid) =>
        entries
          .filter((e) => e.source_id === sid && !e.ok)
          .map((e) => `tier ${e.tier_index} ${e.provider}: ${e.error ?? 'failed'}`)
          .join('; ');

      const sources = [...bySource.values()].map((e) => ({
        source_id: e.source_id,
        tier_used: e.ok ? e.tier_index : -1,
        provider: e.ok ? e.provider : null,
        items: e.ok ? e.items : 0,
        latency_ms: e.latency_ms,
        fallback_reason: e.tier_index > 0 || !e.ok ? errorChain(e.source_id) : undefined,
      }));

      const healthy = sources.filter((s) => s.tier_used === 0).length;
      const degraded = sources.filter((s) => s.tier_used > 0).length;
      const failed = sources.filter((s) => s.tier_used === -1).length;

      const payload = {
        date,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        summary: {
          sources_total: sources.length,
          sources_healthy: healthy,
          sources_degraded: degraded,
          sources_failed: failed,
        },
        quota: quota ?? null,
        sources,
      };

      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, `${date}.json`), JSON.stringify(payload, null, 2));
      return payload;
    },
  };
}
