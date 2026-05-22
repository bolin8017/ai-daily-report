import { Extractors } from './_extractors/index.js';
import { defineProvider } from './_registry.js';

const API = 'https://api.firecrawl.dev/v1/scrape';
const TIMEOUT = 60_000;

export async function firecrawlProvider(cfg, ctx) {
  if (process.env.FIRECRAWL_DISABLED === '1') {
    return { ok: false, items: [], error: 'disabled' };
  }
  if (!process.env.FIRECRAWL_API_KEY) {
    return { ok: false, items: [], error: 'no API key' };
  }
  const extractor = Extractors[ctx.itemType];
  if (!extractor) {
    return { ok: false, items: [], error: `no firecrawl extractor for ${ctx.itemType}` };
  }

  if (ctx.quota) {
    const status = await ctx.quota.canSpend();
    if (!status.allowed) {
      return { ok: false, items: [], error: `quota: ${status.reason ?? 'exhausted'}` };
    }
  }

  try {
    const res = await fetch(API, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: {
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: cfg.url,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const body = await res.json();
    if (!body.success) return { ok: false, items: [], error: body.error ?? 'firecrawl error' };

    if (ctx.quota) await ctx.quota.record(1);

    const md = body.data?.markdown ?? '';
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

defineProvider('firecrawl', firecrawlProvider);
