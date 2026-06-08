import { describe, expect, it } from 'vitest';
import { parseAiderYaml } from '../src/fetchers/providers/leaderboards-parsers/aider.js';
import { parseBfclCsv } from '../src/fetchers/providers/leaderboards-parsers/bfcl.js';
import { parseOcrBenchCsv } from '../src/fetchers/providers/leaderboards-parsers/ocrbench.js';
import { parseSwebenchLeaderboards } from '../src/fetchers/providers/leaderboards-parsers/swebench.js';

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

describe('parseOcrBenchCsv', () => {
  it('ranks an unsorted CSV by Average Score desc', () => {
    const csv = [
      'Model,Open Source,Average Score,Link',
      'ModelA,Yes,55.0,-',
      'ModelB,No,60.2,-',
      'ModelC,Yes,40.1,-',
    ].join('\n');
    const entries = parseOcrBenchCsv(csv);
    expect(entries[0]).toMatchObject({ model_id: 'ModelB', rank: 1, score: 60.2 });
    expect(entries[1]).toMatchObject({ model_id: 'ModelA', rank: 2 });
    expect(entries[2].rank).toBe(3);
  });

  it('drops rows with a non-numeric score', () => {
    const csv = ['Model,Average Score', 'Good,50.0', 'Bad,-'].join('\n');
    const entries = parseOcrBenchCsv(csv);
    expect(entries).toHaveLength(1);
    expect(entries[0].model_id).toBe('Good');
  });
});

describe('parseSwebenchLeaderboards', () => {
  it('picks the Verified board and ranks by resolved desc', () => {
    const data = {
      leaderboards: [
        { name: 'Lite', results: [{ name: 'x', resolved: 99 }] },
        {
          name: 'Verified',
          results: [
            { name: 'agent-a', resolved: 70.0 },
            { name: 'agent-b', resolved: 79.2 },
          ],
        },
      ],
    };
    const entries = parseSwebenchLeaderboards(data);
    expect(entries[0]).toMatchObject({ model_id: 'agent-b', rank: 1, score: 79.2 });
    expect(entries[1].model_id).toBe('agent-a');
  });

  it('returns [] when the split is missing', () => {
    expect(parseSwebenchLeaderboards({ leaderboards: [] })).toEqual([]);
  });
});

describe('parseAiderYaml', () => {
  it('ranks by best pass_rate_2 per model, deduping multiple runs', () => {
    const yaml = [
      '- model: Model A',
      '  edit_format: diff',
      '  pass_rate_2: 70.0',
      '- model: Model A',
      '  edit_format: whole',
      '  pass_rate_2: 82.5',
      '- model: Model B',
      '  pass_rate_2: 88.1',
      '- model: Model C',
      '  pass_rate_2: 40.0',
    ].join('\n');
    const entries = parseAiderYaml(yaml);
    expect(entries).toHaveLength(3); // Model A's two runs collapse to one
    expect(entries[0]).toMatchObject({ model_id: 'Model B', rank: 1, score: 88.1 });
    expect(entries[1]).toMatchObject({ model_id: 'Model A', rank: 2, score: 82.5 });
    expect(entries[2]).toMatchObject({ model_id: 'Model C', rank: 3 });
  });

  it('drops entries with no model or a non-numeric pass_rate_2', () => {
    const yaml = [
      '- model: Good',
      '  pass_rate_2: 50.0',
      '- model: Bad',
      '  pass_rate_2: null',
      '- edit_format: whole',
      '  pass_rate_2: 99',
    ].join('\n');
    const entries = parseAiderYaml(yaml);
    expect(entries).toHaveLength(1);
    expect(entries[0].model_id).toBe('Good');
  });

  it('returns [] for non-list YAML', () => {
    expect(parseAiderYaml('foo: bar')).toEqual([]);
  });
});
