import { defineProvider } from './_registry.js';
import { diffSnapshots, loadPrevSnapshot, saveSnapshot } from './leaderboards-parsers/_base.js';
import { fetchBfcl } from './leaderboards-parsers/bfcl.js';
import { fetchMteb } from './leaderboards-parsers/mteb.js';
import { fetchOcrBench } from './leaderboards-parsers/ocrbench.js';
import { fetchPinchBench } from './leaderboards-parsers/pinchbench.js';
import { fetchSwebench } from './leaderboards-parsers/swebench.js';

const FETCHERS = {
  bfcl: fetchBfcl,
  mteb: fetchMteb,
  ocrbench: fetchOcrBench,
  pinchbench: fetchPinchBench,
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
