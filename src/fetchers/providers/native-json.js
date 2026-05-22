import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;

export async function nativeJSONProvider(cfg, ctx) {
  const res = await fetch(cfg.url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
  });
  if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
  const data = await res.json();
  if (!Array.isArray(data)) return { ok: false, items: [], error: 'expected array' };
  const items = data.slice(0, cfg.limit ?? 30).map((item, i) => ({
    source: cfg.sourceName ?? ctx.sourceId,
    category: cfg.category,
    title: item.title ?? '',
    url: item.link ?? item.url ?? '',
    description: item.description ?? '',
    author: item.author ?? '',
    published: item.isoDate ?? item.pubDate ?? item.published ?? null,
    rank: i + 1,
  }));
  return { ok: true, items };
}

defineProvider('native-json', nativeJSONProvider);
