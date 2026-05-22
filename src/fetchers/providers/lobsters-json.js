import { defineProvider } from './_registry.js';

const TIMEOUT = 30_000;

export async function lobstersJSONProvider(cfg, _ctx) {
  const res = await fetch(cfg.url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
  });
  if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
  const data = await res.json();
  if (!Array.isArray(data)) return { ok: false, items: [], error: 'expected array' };
  const items = data.slice(0, cfg.limit ?? 15).map((item, i) => ({
    source: 'lobsters',
    category: 'community',
    title: item.title ?? '',
    url: item.url || `https://lobste.rs/s/${item.short_id}`,
    description: (item.description ?? '').slice(0, 500),
    author: item.submitter_user?.username ?? '',
    tags: item.tags ?? [],
    published: item.created_at ?? null,
    rank: i + 1,
  }));
  return { ok: true, items };
}

defineProvider('lobsters-json', lobstersJSONProvider);
