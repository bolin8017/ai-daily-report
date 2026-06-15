import { BENCH_LEADERBOARD_URL } from '../../lib/leaderboard-urls.js';
import { defineProvider } from './_registry.js';
import { diffSnapshots, loadPrevSnapshot, saveSnapshot } from './leaderboards-parsers/_base.js';
import { fetchBfcl } from './leaderboards-parsers/bfcl.js';
import { fetchLmarena } from './leaderboards-parsers/lmarena.js';

// mteb + pinchbench dropped 2026-05-25: MTEB no longer publishes a precomputed
// ranking (the leaderboard is computed client-side by the mteb package), and
// pinchbench exposes no stable API (data only lives in its Next.js RSC stream).
// Both would require exactly the fragile scraping this provider moved away from.
// ocrbench + aider + swebench dropped 2026-06-15: unreliable / low signal;
// replaced incrementally by the leaderboard-redesign branch.
const FETCHERS = {
  bfcl: fetchBfcl,
  lmarena: fetchLmarena,
};

export async function leaderboardHtmlProvider(cfg, _ctx) {
  const fetcher = FETCHERS[cfg.parser];
  if (!fetcher) {
    return { ok: false, items: [], error: `unknown leaderboard parser: ${cfg.parser}` };
  }
  try {
    const ranking = await fetcher(cfg);
    if (!ranking || ranking.length === 0) {
      return { ok: false, items: [], error: 'no rankings parsed' };
    }
    const prev = await loadPrevSnapshot(cfg.parser);
    await saveSnapshot(cfg.parser, ranking);
    const d = diffSnapshots(prev, ranking);

    // Event-driven: a board with no new top-5 entrant and no rank movement is a
    // non-event (e.g. BFCL frozen since 2026-04) — do not hand the curator a
    // "maintains leadership" item to write. Cold-start (prev===null) yields a
    // full new_top_5, so a board still surfaces the first time we ever see it.
    const changed = (d.new_top_5?.length ?? 0) > 0 || (d.rank_changes?.length ?? 0) > 0;
    if (!changed) {
      return { ok: true, items: [] };
    }
    return {
      ok: true,
      items: [
        {
          bench: cfg.parser,
          // Canonical leaderboard link, stamped from the single source of truth
          // so the curator never has to (and never should) invent one.
          url: BENCH_LEADERBOARD_URL[cfg.parser],
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
