import { Extractors } from './_extractors/index.js';
import { defineProvider } from './_registry.js';

const BASE = 'https://r.jina.ai';
const TIMEOUT = 30_000;

export async function jinaReaderProvider(cfg, ctx) {
  if (process.env.JINA_DISABLED === '1') {
    return { ok: false, items: [], error: 'disabled' };
  }
  const extractor = Extractors[ctx.itemType];
  if (!extractor) {
    return { ok: false, items: [], error: `no jina extractor for ${ctx.itemType}` };
  }
  try {
    const url = `${BASE}/${cfg.url}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'User-Agent': 'ai-daily-report/1.0' },
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const md = await res.text();
    const items = extractor(md, {
      sourceUrl: cfg.url,
      sourceName: cfg.sourceName ?? ctx.sourceId,
      category: cfg.category,
    });
    if (!items || items.length === 0) {
      return { ok: false, items: [], error: 'extractor returned 0 items' };
    }
    return { ok: true, items };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('jina-reader', jinaReaderProvider);
