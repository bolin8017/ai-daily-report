import { describe, expect, it } from 'vitest';
import { parseBfclTable } from '../src/fetchers/providers/leaderboards-parsers/bfcl.js';
import { parseMtebResults } from '../src/fetchers/providers/leaderboards-parsers/mteb.js';
import { parseOcrBenchTable } from '../src/fetchers/providers/leaderboards-parsers/ocrbench.js';
import { parsePinchBenchResults } from '../src/fetchers/providers/leaderboards-parsers/pinchbench.js';
import { parseSwebenchResults } from '../src/fetchers/providers/leaderboards-parsers/swebench.js';

describe('parseMtebResults', () => {
  it('sorts by avg_score, assigns ranks', () => {
    const entries = parseMtebResults([
      { model: 'voyage-2', avg_score: 62.1 },
      { model: 'bge-large-en-v1.5', avg_score: 64.23 },
    ]);
    expect(entries[0]).toMatchObject({ model_id: 'bge-large-en-v1.5', rank: 1, score: 64.23 });
    expect(entries[1].rank).toBe(2);
  });
});

describe('parsePinchBenchResults', () => {
  it('handles results JSON shape', () => {
    const entries = parsePinchBenchResults({
      results: [
        { model: 'claude-opus-4-7', success_rate: 0.834 },
        { model: 'gpt-5.3-codex', success_rate: 0.812 },
      ],
    });
    expect(entries[0].model_id).toBe('claude-opus-4-7');
    expect(entries[0].rank).toBe(1);
    expect(entries[0].score).toBe(0.834);
  });
});

describe('parseBfclTable', () => {
  it('extracts entries from HTML table', () => {
    const html = `
      <table>
        <tr><th>Rank</th><th>Model</th><th>Overall</th></tr>
        <tr><td>1</td><td>claude-opus-4-7</td><td>87.6</td></tr>
        <tr><td>2</td><td>gpt-5.3</td><td>86.2</td></tr>
      </table>
    `;
    const entries = parseBfclTable(html);
    expect(entries[0]).toMatchObject({ model_id: 'claude-opus-4-7', rank: 1, score: 87.6 });
    expect(entries[1].model_id).toBe('gpt-5.3');
  });
});

describe('parseSwebenchResults', () => {
  it('handles results JSON shape', () => {
    const entries = parseSwebenchResults({
      results: [
        { model: 'a', resolved_rate: 0.7 },
        { model: 'b', resolved_rate: 0.8 },
      ],
    });
    expect(entries[0].model_id).toBe('b');
    expect(entries[0].rank).toBe(1);
  });
});

describe('parseOcrBenchTable', () => {
  it('extracts entries from markdown table', () => {
    const md = `
| Model | Other | Score |
| --- | --- | --- |
| ModelA | x | 85.0 |
| ModelB | x | 88.5 |
| ModelC | x | 70.0 |
`;
    const entries = parseOcrBenchTable(md);
    expect(entries[0]).toMatchObject({ model_id: 'ModelB', rank: 1, score: 88.5 });
    expect(entries[1].model_id).toBe('ModelA');
  });
});
