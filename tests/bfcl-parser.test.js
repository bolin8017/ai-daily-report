import { describe, expect, it } from 'vitest';
import { parseBfclCsv } from '../src/fetchers/providers/leaderboards-parsers/bfcl.js';

describe('parseBfclCsv', () => {
  it('parses data_overall.csv, keeps Rank order, strips % from score', () => {
    const csv = [
      'Rank,Overall Acc,Model,Model Link,Organization',
      '1,77.47%,Claude-Opus-4-5 (FC),https://x,Anthropic',
      '2,75.10%,GPT-5.3 (FC),https://y,OpenAI',
    ].join('\n');
    const entries = parseBfclCsv(csv);
    expect(entries[0]).toMatchObject({ model_id: 'Claude-Opus-4-5 (FC)', rank: 1, score: 77.47 });
    expect(entries[1].model_id).toBe('GPT-5.3 (FC)');
  });

  it('handles quoted fields containing commas', () => {
    const csv = ['Rank,Overall Acc,Model', '1,80.0%,"Model, v2"'].join('\n');
    expect(parseBfclCsv(csv)[0].model_id).toBe('Model, v2');
  });

  it('strips a leading UTF-8 BOM so the first header key is intact', () => {
    const csv = `﻿${['Rank,Overall Acc,Model', '1,80.0%,ModelA'].join('\n')}`;
    expect(parseBfclCsv(csv)[0]).toMatchObject({ model_id: 'ModelA', rank: 1, score: 80 });
  });
});
