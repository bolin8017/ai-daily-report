import { describe, expect, it } from 'vitest';
import {
  formatStageSummary,
  parseStageResults,
  summarizeStages,
} from '../src/ops/stage-results.js';

function line(stage, status, extra = {}) {
  return JSON.stringify({
    stage,
    status,
    run_id: 'r1',
    cost_usd: 0,
    tokens: 0,
    error: null,
    ...extra,
  });
}

describe('parseStageResults', () => {
  it('extracts only well-formed stage+status JSON lines', () => {
    const log = [
      '[run.sh] starting',
      line('collect', 'ok'),
      'not json',
      '{"partial": true}', // no stage/status
      line('curate.market', 'failed', { error: 'boom' }),
      '   ', // blank
    ].join('\n');
    const records = parseStageResults(log);
    expect(records.map((r) => r.stage)).toEqual(['collect', 'curate.market']);
    expect(records[1].error).toBe('boom');
  });

  it('returns [] for empty / nullish input', () => {
    expect(parseStageResults('')).toEqual([]);
    expect(parseStageResults(undefined)).toEqual([]);
  });
});

describe('summarizeStages', () => {
  it('keeps the latest status per stage and buckets failed/degraded', () => {
    const records = parseStageResults(
      [
        line('collect', 'ok'),
        line('curate.market', 'failed', { error: 'x' }),
        line('faithfulness', 'degraded'),
        line('merge', 'blocked'),
      ].join('\n'),
    );
    const s = summarizeStages(records);
    expect(s.byStage['curate.market'].status).toBe('failed');
    expect(s.failed.sort()).toEqual(['curate.market', 'merge']);
    expect(s.degraded).toEqual(['faithfulness']);
    expect(s.lastStage).toBe('merge');
    expect(s.runId).toBe('r1');
  });

  it('detects an auto-recovered stage (failed earlier, fine later) and is clean', () => {
    const records = parseStageResults(
      [
        line('curate.market', 'failed', { cost_usd: 0.01 }),
        line('curate.market', 'ok', { cost_usd: 0.02 }), // retry succeeded
        line('synthesize', 'ok', { cost_usd: 0.5 }),
        line('merge', 'ok'),
      ].join('\n'),
    );
    const s = summarizeStages(records);
    expect(s.retried).toEqual(['curate.market']);
    expect(s.failed).toEqual([]); // latest curate.market is ok
    expect(s.byStage['curate.market'].status).toBe('ok');
    // total cost sums ALL attempts including the failed first one
    expect(s.totalCostUsd).toBeCloseTo(0.53);
  });
});

describe('formatStageSummary', () => {
  it('renders markers, recovery note, and totals', () => {
    const records = parseStageResults(
      [line('collect', 'ok'), line('curate.market', 'failed', { error: 'boom' })].join('\n'),
    );
    const text = formatStageSummary(summarizeStages(records));
    expect(text).toMatch(/repo_run_id: r1/);
    expect(text).toMatch(/✗ curate\.market: failed — boom/);
    expect(text).toMatch(/· collect: ok/);
    expect(text).toMatch(/total: \$0\.0000/);
  });
});
