import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/fetchers/providers/leaderboards-parsers/_base.js', async (orig) => ({
  ...(await orig()),
  loadPrevSnapshot: vi.fn(),
  saveSnapshot: vi.fn(),
}));
vi.mock('../src/fetchers/providers/leaderboards-parsers/bfcl.js', () => ({
  fetchBfcl: () =>
    Promise.resolve([
      { model_id: 'A', rank: 1, score: 90 },
      { model_id: 'B', rank: 2, score: 80 },
    ]),
}));

import { leaderboardHtmlProvider } from '../src/fetchers/providers/leaderboard-html.js';
import * as base from '../src/fetchers/providers/leaderboards-parsers/_base.js';

beforeEach(() => vi.clearAllMocks());

it('emits an item on a real rank change', async () => {
  base.loadPrevSnapshot.mockResolvedValue([
    { model_id: 'B', rank: 1, score: 95 },
    { model_id: 'A', rank: 2, score: 80 },
  ]);
  const r = await leaderboardHtmlProvider({ parser: 'bfcl' });
  expect(r.items).toHaveLength(1);
  expect(base.saveSnapshot).toHaveBeenCalled();
});

it('emits NO item when nothing changed (still persists)', async () => {
  base.loadPrevSnapshot.mockResolvedValue([
    { model_id: 'A', rank: 1, score: 90 },
    { model_id: 'B', rank: 2, score: 80 },
  ]);
  const r = await leaderboardHtmlProvider({ parser: 'bfcl' });
  expect(r.items).toHaveLength(0);
  expect(base.saveSnapshot).toHaveBeenCalled();
});

it('emits an item on cold start (no prev snapshot)', async () => {
  base.loadPrevSnapshot.mockResolvedValue(null);
  const r = await leaderboardHtmlProvider({ parser: 'bfcl' });
  expect(r.items).toHaveLength(1);
});
