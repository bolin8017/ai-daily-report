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
vi.mock('../src/fetchers/providers/leaderboards-parsers/epoch.js', () => ({
  fetchEpoch: () => Promise.resolve([{ model_id: 'M', rank: 1, score: 0.9 }]),
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

it('keys snapshots by cfg.bench for multi-board parsers (epoch)', async () => {
  base.loadPrevSnapshot.mockResolvedValue(null);
  await leaderboardHtmlProvider({
    parser: 'epoch',
    bench: 'epoch-gpqa',
    benchmark: 'GPQA diamond',
  });
  await leaderboardHtmlProvider({ parser: 'epoch', bench: 'epoch-hle', benchmark: 'HLE' });
  const keys = base.saveSnapshot.mock.calls.map((c) => c[0]);
  expect(keys).toContain('epoch-gpqa');
  expect(keys).toContain('epoch-hle');
});
