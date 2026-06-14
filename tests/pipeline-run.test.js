import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downstreamOf, runPipeline } from '../src/pipeline/run.js';

const TODAY = '2026-06-04';
const ALL = [
  'collect',
  'curate.discoveries',
  'curate.pulse',
  'curate.market',
  'curate.tech',
  'context',
  'synthesize',
  'faithfulness',
  'merge',
];

let dir;
let staging;
let reports;
beforeEach(() => {
  // Empty temp dirs keep the real satisfiedFn / curateItemCount reads as no-ops;
  // tests below inject satisfiedFn so disk is only used by the suspicious-empty case.
  dir = mkdtempSync(path.join(tmpdir(), 'sequencer-'));
  staging = path.join(dir, 'staging');
  reports = path.join(dir, 'reports');
  mkdirSync(path.join(staging, 'curated'), { recursive: true });
  mkdirSync(reports, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// Synthetic harness: an injected satisfiedFn backed by a Set (no disk), and a
// mock runStage that records call order, tracks max concurrency, marks a stage
// satisfied on a clean exit, and honors per-stage {exitCode, invalid} overrides.
function harness({ satisfied = [], results = {} } = {}) {
  const sat = new Set(satisfied);
  const calls = [];
  const emitted = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const runStage = async (stage) => {
    calls.push(stage.id);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve(); // yield so concurrent batch members overlap
    const r = results[stage.id] ?? {};
    const exitCode = r.exitCode ?? 0;
    if (exitCode === 0 && !r.invalid) sat.add(stage.id);
    inFlight -= 1;
    return { exitCode, duration_ms: 1, cost_usd: r.cost_usd ?? 0, tokens: r.tokens ?? 0 };
  };
  const satisfiedFn = (id) => ({ satisfied: sat.has(id) });
  const emit = (r) => emitted.push(r);
  return {
    calls,
    emitted,
    run: (opts = {}) =>
      runPipeline({
        today: TODAY,
        stagingDir: staging,
        reportsDir: reports,
        runStage,
        satisfiedFn,
        emit,
        ...opts,
      }),
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

describe('runPipeline — resume / topo', () => {
  it('runs the whole chain in topo order when nothing is satisfied', async () => {
    const h = harness();
    const { ok } = await h.run();
    expect(ok).toBe(true);
    expect([...h.calls].sort()).toEqual([...ALL].sort());
    const pos = (id) => h.calls.indexOf(id);
    expect(pos('collect')).toBeLessThan(pos('curate.discoveries'));
    expect(pos('curate.market')).toBeLessThan(pos('context'));
    expect(pos('context')).toBeLessThan(pos('synthesize'));
    expect(pos('synthesize')).toBeLessThan(pos('faithfulness'));
    expect(pos('faithfulness')).toBeLessThan(pos('merge'));
  });

  it('resume skips satisfied stages and re-runs only the rest (token saving)', async () => {
    const h = harness({
      satisfied: [
        'collect',
        'curate.discoveries',
        'curate.pulse',
        'curate.market',
        'curate.tech',
        'context',
      ],
    });
    const { ok } = await h.run();
    expect(ok).toBe(true);
    expect(h.calls).toEqual(['synthesize', 'faithfulness', 'merge']);
    expect(
      h.emitted
        .filter((e) => e.status === 'skipped')
        .map((e) => e.stage)
        .sort(),
    ).toEqual([
      'collect',
      'context',
      'curate.discoveries',
      'curate.market',
      'curate.pulse',
      'curate.tech',
    ]);
  });

  it('runs the curators as one concurrent batch', async () => {
    const h = harness();
    await h.run();
    // collect alone, then the 4 required curators (discoveries/pulse/market/tech)
    // all batch together (all depend only on collect).
    expect(h.maxInFlight).toBe(4);
  });
});

describe('runPipeline — barrier', () => {
  it('blocks synthesize/context/merge when a required curator fails', async () => {
    const h = harness({ results: { 'curate.market': { exitCode: 1 } } });
    const { ok } = await h.run();
    expect(ok).toBe(false);
    expect(h.calls).not.toContain('context');
    expect(h.calls).not.toContain('synthesize');
    expect(h.calls).not.toContain('merge');
    const blocked = h.emitted.filter((e) => e.status === 'blocked').map((e) => e.stage);
    expect(blocked).toContain('context');
    expect(blocked).toContain('synthesize');
    expect(blocked).toContain('merge');
    expect(h.emitted.find((e) => e.stage === 'curate.market').status).toBe('failed');
  });

  it('a required stage that exits 0 but produces invalid output is failed, not ok', async () => {
    const h = harness({ results: { synthesize: { exitCode: 0, invalid: true } } });
    const { ok } = await h.run();
    expect(ok).toBe(false);
    expect(h.emitted.find((e) => e.stage === 'synthesize').status).toBe('failed');
    expect(h.calls).not.toContain('merge');
  });
});

describe('runPipeline — optional never blocks', () => {
  it('merge still runs when faithfulness fails', async () => {
    const h = harness({ results: { faithfulness: { exitCode: 1 } } });
    const { ok } = await h.run();
    expect(ok).toBe(true);
    expect(h.calls).toContain('merge');
    expect(h.emitted.find((e) => e.stage === 'faithfulness').status).toBe('degraded');
  });

  it('merge still runs when faithfulness exits 0 without writing an audit', async () => {
    const h = harness({ results: { faithfulness: { exitCode: 0, invalid: true } } });
    const { ok } = await h.run();
    expect(ok).toBe(true);
    expect(h.calls).toContain('merge');
    expect(h.emitted.find((e) => e.stage === 'faithfulness').status).toBe('degraded');
  });
});

describe('runPipeline — modes', () => {
  it('--only runs exactly the named stage', async () => {
    const h = harness();
    const { ok } = await h.run({ mode: 'only', targets: ['curate.market'] });
    expect(ok).toBe(true);
    expect(h.calls).toEqual(['curate.market']);
  });

  it('--force re-runs a satisfied stage but leaves a satisfied downstream alone', async () => {
    const h = harness({ satisfied: ALL });
    await h.run({ mode: 'force', targets: ['synthesize'] });
    expect(h.calls).toEqual(['synthesize']); // merge stays satisfied → skipped
  });

  it('--from re-runs the stage and everything downstream', async () => {
    const h = harness({ satisfied: ALL });
    await h.run({ mode: 'from', targets: ['synthesize'] });
    expect(h.calls).toEqual(['synthesize', 'faithfulness', 'merge']);
  });

  it('--accept-missing downgrades a barrier and proceeds (ok)', async () => {
    const h = harness({ results: { 'curate.market': { exitCode: 1 } } });
    const { ok } = await h.run({ acceptMissing: ['curate.market'] });
    expect(ok).toBe(true);
    expect(h.calls).toContain('synthesize');
    expect(h.calls).toContain('merge');
  });
});

// Auto-recover harness: runStage result depends on call COUNT, so a stage can
// fail once then succeed on retry. `failTimes[id] = n` fails the first n calls;
// `alwaysFail` fails every call.
function recoverHarness({ failTimes = {}, alwaysFail = [] } = {}) {
  const sat = new Set();
  const calls = [];
  const counts = {};
  const emitted = [];
  const runStage = async (stage) => {
    calls.push(stage.id);
    counts[stage.id] = (counts[stage.id] ?? 0) + 1;
    await Promise.resolve();
    const fails = alwaysFail.includes(stage.id) || counts[stage.id] <= (failTimes[stage.id] ?? 0);
    if (fails) sat.delete(stage.id);
    else sat.add(stage.id);
    return { exitCode: fails ? 1 : 0, duration_ms: 1, cost_usd: 0, tokens: 0 };
  };
  return {
    calls,
    counts,
    emitted,
    run: (opts = {}) =>
      runPipeline({
        today: TODAY,
        stagingDir: staging,
        reportsDir: reports,
        runStage,
        satisfiedFn: (id) => ({ satisfied: sat.has(id) }),
        emit: (r) => emitted.push(r),
        ...opts,
      }),
  };
}

describe('runPipeline — auto-recover', () => {
  it('retries a retryable stage that failed once, then completes downstream', async () => {
    const h = recoverHarness({ failTimes: { 'curate.market': 1 } });
    const { ok, recovery } = await h.run({ autoRecover: true });
    expect(ok).toBe(true);
    expect(h.counts['curate.market']).toBe(2); // failed once, retried, succeeded
    expect(recovery.attempted).toBe(true);
    expect(recovery.targets).toEqual(['curate.market']);
    // downstream that the failure had blocked now runs on the recovery pass
    expect(h.calls).toContain('synthesize');
    expect(h.calls).toContain('merge');
    // sibling curators that already succeeded are NOT re-run
    expect(h.counts['curate.discoveries']).toBe(1);
  });

  it('retries at most once — a persistently failing stage still fails', async () => {
    const h = recoverHarness({ alwaysFail: ['curate.market'] });
    const { ok, recovery } = await h.run({ autoRecover: true });
    expect(ok).toBe(false);
    expect(h.counts['curate.market']).toBe(2); // exactly one retry, then give up
    expect(recovery.attempted).toBe(true);
    expect(h.calls).not.toContain('merge');
  });

  it('never retries a deterministic stage (recovery: none) even on failure', async () => {
    const h = recoverHarness({ alwaysFail: ['merge'] });
    const { ok, recovery } = await h.run({ autoRecover: true });
    expect(ok).toBe(false);
    expect(h.counts.merge).toBe(1); // merge is recovery:'none' — not retried
    expect(recovery.attempted).toBe(false);
  });

  it('does not retry when --auto-recover is off (default)', async () => {
    const h = recoverHarness({ failTimes: { 'curate.market': 1 } });
    const { ok, recovery } = await h.run();
    expect(ok).toBe(false);
    expect(h.counts['curate.market']).toBe(1);
    expect(recovery.attempted).toBe(false);
  });
});

describe('runPipeline — dry run + emission', () => {
  it('dry-run spawns nothing and reports skip vs would-run', async () => {
    const h = harness({ satisfied: ['collect'] });
    const { ok } = await h.run({ dryRun: true });
    expect(ok).toBe(true);
    expect(h.calls).toEqual([]); // injected runStage never invoked
    expect(h.emitted.find((e) => e.stage === 'collect').status).toBe('skipped');
    expect(h.emitted.find((e) => e.stage === 'synthesize').status).toBe('ok'); // would run
  });

  it('every emitted result carries the §8.3 shape', async () => {
    const h = harness();
    await h.run();
    for (const r of h.emitted) {
      expect(r).toHaveProperty('stage');
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('run_id');
      expect(r).toHaveProperty('outputs');
      expect(r).toHaveProperty('cost_usd');
      expect(r).toHaveProperty('tokens');
      expect(r).toHaveProperty('duration_ms');
      expect(r).toHaveProperty('error');
    }
  });
});

describe('runPipeline — suspicious-empty (disk-backed)', () => {
  it('flags a curator that validates but holds zero items, run still ok', async () => {
    // Real satisfiedFn would skip an existing fresh file, so keep the injected
    // satisfiedFn but have the mock runStage WRITE an empty-items output that
    // curateItemCount then reads off disk.
    const sat = new Set([
      'collect',
      'curate.pulse',
      'curate.market',
      'curate.tech',
      'context',
      'synthesize',
      'faithfulness',
      'merge',
    ]);
    const emitted = [];
    const runStage = async (stage) => {
      if (stage.id === 'curate.discoveries') {
        writeFileSync(
          path.join(staging, 'curated', 'discoveries.json'),
          JSON.stringify({ rising: [], dev_watch: [] }),
        );
      }
      sat.add(stage.id);
      return { exitCode: 0, duration_ms: 1, cost_usd: 0, tokens: 0 };
    };
    const { ok } = await runPipeline({
      today: TODAY,
      stagingDir: staging,
      reportsDir: reports,
      runStage,
      satisfiedFn: (id) => ({ satisfied: sat.has(id) }),
      emit: (r) => emitted.push(r),
    });
    expect(ok).toBe(true);
    expect(emitted.find((e) => e.stage === 'curate.discoveries').status).toBe('suspicious-empty');
  });
});

describe('downstreamOf', () => {
  it('returns transitive dependents in the DAG', () => {
    expect(downstreamOf('synthesize').sort()).toEqual(['faithfulness', 'merge']);
    expect(downstreamOf('collect')).toContain('merge');
  });
});
