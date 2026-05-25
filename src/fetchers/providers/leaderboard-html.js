import { defineProvider } from './_registry.js';
import { diffSnapshots, loadPrevSnapshot, saveSnapshot } from './leaderboards-parsers/_base.js';
import { fetchBfcl } from './leaderboards-parsers/bfcl.js';
import { fetchOcrBench } from './leaderboards-parsers/ocrbench.js';
import { fetchSwebench } from './leaderboards-parsers/swebench.js';

// mteb + pinchbench dropped 2026-05-25: MTEB no longer publishes a precomputed
// ranking (the leaderboard is computed client-side by the mteb package), and
// pinchbench exposes no stable API (data only lives in its Next.js RSC stream).
// Both would require exactly the fragile scraping this provider moved away from.
const FETCHERS = {
  bfcl: fetchBfcl,
  ocrbench: fetchOcrBench,
  swebench: fetchSwebench,
};

export async function leaderboardHtmlProvider(cfg, _ctx) {
  const fetcher = FETCHERS[cfg.parser];
  if (!fetcher) {
    return { ok: false, items: [], error: `unknown leaderboard parser: ${cfg.parser}` };
  }
  try {
    const ranking = await fetcher();
    if (!ranking || ranking.length === 0) {
      return { ok: false, items: [], error: 'no rankings parsed' };
    }
    const prev = await loadPrevSnapshot(cfg.parser);
    await saveSnapshot(cfg.parser, ranking);
    const d = diffSnapshots(prev, ranking);
    return {
      ok: true,
      items: [
        {
          bench: cfg.parser,
          fetched_at: new Date().toISOString(),
          ...d,
        },
      ],
    };
  } catch (err) {
    return { ok: false, items: [], error: err.message };
  }
}

defineProvider('leaderboard-html', leaderboardHtmlProvider);
