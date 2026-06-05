import { defineProvider } from './_registry.js';

const BASE = 'https://hacker-news.firebaseio.com/v0';

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'ai-daily-report/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function hnFirebaseProvider(cfg, _ctx) {
  const list = cfg.list ?? 'topstories';
  const limit = cfg.limit ?? 30;
  try {
    const ids = await fetchJson(`${BASE}/${list}.json`);
    const top = ids.slice(0, limit);
    const stories = await Promise.all(top.map((id) => fetchJson(`${BASE}/item/${id}.json`)));
    const items = stories
      .map((s, i) => {
        if (!s?.id) return null;
        const hnUrl = `https://news.ycombinator.com/item?id=${s.id}`;
        return {
          source: 'hackernews',
          title: s.title ?? '',
          url: s.url || hnUrl,
          hn_url: hnUrl,
          hn_id: String(s.id),
          author: s.by ?? '',
          published: s.time ? new Date(s.time * 1000).toISOString() : null,
          rank: i + 1,
          score: s.score ?? 0,
          num_comments: s.descendants ?? 0,
        };
      })
      .filter(Boolean);
    return { ok: items.length > 0, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('hn-firebase', hnFirebaseProvider);
