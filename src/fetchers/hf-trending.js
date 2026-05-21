#!/usr/bin/env node
// Fetcher: HuggingFace Trending Models JSON API.
// Endpoint: https://huggingface.co/api/models?sort=trendingScore&direction=-1&limit=N

import { runAsStandalone } from './_dispatch.js';

const HF_API = 'https://huggingface.co/api/models';
const USER_AGENT = 'ai-daily-report/1.0';

export function normalizeHFModel(raw) {
  return {
    id: raw.id,
    url: `https://huggingface.co/${raw.id}`,
    downloads: raw.downloads ?? null,
    likes: raw.likes ?? null,
    last_modified: raw.lastModified ?? null,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    pipeline_tag: raw.pipeline_tag ?? null,
  };
}

export async function fetchHFTrending({ limit = 20 } = {}) {
  const url = `${HF_API}?sort=trendingScore&direction=-1&limit=${limit}`;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      return { ok: false, items: [], error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    if (!Array.isArray(data)) {
      return { ok: false, items: [], error: 'Unexpected shape' };
    }
    return { ok: true, items: data.map(normalizeHFModel) };
  } catch (e) {
    return { ok: false, items: [], error: e.message };
  }
}

runAsStandalone(import.meta.url, fetchHFTrending);
