import { defineProvider } from './_registry.js';

const HF_API = 'https://huggingface.co/api/models';

export async function hfTrendingJsonProvider(cfg, _ctx) {
  const limit = cfg.limit ?? 20;
  const url = `${HF_API}?sort=trendingScore&direction=-1&limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ai-daily-report/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false, items: [], error: 'unexpected shape' };
    const items = data.map((raw) => ({
      id: raw.id,
      url: `https://huggingface.co/${raw.id}`,
      downloads: raw.downloads ?? null,
      likes: raw.likes ?? null,
      last_modified: raw.lastModified ?? null,
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      pipeline_tag: raw.pipeline_tag ?? null,
    }));
    return { ok: true, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('hf-trending-json', hfTrendingJsonProvider);
