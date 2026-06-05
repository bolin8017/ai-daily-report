// Deterministic DAG sequencer for the daily pipeline. Reads the stage registry
// (stages.js) + the satisfied() resume check, runs unsatisfied stages in topo
// order as parallel batches, halts at a barrier when a required dependency can't
// be satisfied, and emits one structured JSON result line per stage for Hermes
// (spec §8). The orchestration core runPipeline() is pure: runStage, satisfiedFn,
// and emit are injectable, so resume/skip/barrier/auto-recover logic is unit-tested
// with mocks — no claude -p, no child processes. The bottom isMain CLI shim wires the
// real spawner and parses --resume/--only/--from/--force/--accept-missing/--dry-run/
// --auto-recover.

import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { satisfied as defaultSatisfied } from './satisfied.js';
import { getStage, isRetryable, STAGES, topoOrder } from './stages.js';

// A dependency in one of these states is "available" — a dependent may proceed.
const AVAILABLE = new Set(['satisfied', 'ok', 'degraded', 'suspicious-empty', 'skipped']);
// ...and one of these is "unavailable" — it blocks a required dependent.
const UNAVAILABLE = new Set(['failed', 'blocked']);

// Transitive dependents of a stage — used by `--from` to invalidate downstream.
export function downstreamOf(stageId) {
  const out = new Set();
  let added = true;
  while (added) {
    added = false;
    for (const s of STAGES) {
      if (out.has(s.id)) continue;
      if (s.deps.some((d) => d === stageId || out.has(d))) {
        out.add(s.id);
        added = true;
      }
    }
  }
  return [...out];
}

function readMeta(stagingDir) {
  try {
    return JSON.parse(readFileSync(path.join(stagingDir, 'metadata.json'), 'utf8'));
  } catch {
    return {};
  }
}

// Coarse suspicious-empty signal (spec §13.5): a curate.* output that validated
// but holds zero items. Precise considered/selected accounting is deferred.
function curateItemCount(stagingDir, stage) {
  if (!stage.id.startsWith('curate.')) return null;
  try {
    const json = JSON.parse(readFileSync(path.join(stagingDir, stage.outputs[0]), 'utf8'));
    return Object.values(json).filter(Array.isArray).flat().length;
  } catch {
    return null;
  }
}

// ---- default real stage spawner (replaced by a mock in tests) -------------

function spawnAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(127));
  });
}

const SIDECAR_FILE = { synthesize: 'synthesize.meta.json', faithfulness: 'faithfulness.meta.json' };
function readSidecar(stagingDir, stageId) {
  const file = stageId.startsWith('curate.')
    ? `${stageId.slice('curate.'.length)}.meta.json`
    : SIDECAR_FILE[stageId];
  if (!file) return {};
  try {
    return JSON.parse(readFileSync(path.join(stagingDir, 'curated', '.logs', file), 'utf8'));
  } catch {
    return {};
  }
}

async function spawnStage(stage, { stagingDir, repoRoot }) {
  const t0 = Date.now();
  const [cmd, ...args] = stage.command;
  const exitCode = await spawnAsync(cmd, args, { cwd: repoRoot, env: process.env });
  const side = readSidecar(stagingDir, stage.id);
  return {
    exitCode,
    duration_ms: Date.now() - t0,
    cost_usd: typeof side.cost_usd === 'number' ? side.cost_usd : 0,
    tokens: Number.isInteger(side.output_tokens) ? side.output_tokens : 0,
  };
}

function emitLine(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function buildResult(stage, status, extra) {
  return {
    stage: stage.id,
    status,
    run_id: extra.runId ?? null,
    outputs: stage.outputs,
    cost_usd: extra.cost_usd ?? 0,
    tokens: extra.tokens ?? 0,
    duration_ms: extra.duration_ms ?? 0,
    error: extra.error ?? null,
  };
}

function classify(stage, res, { rawSatisfied, stagingDir, dryRun }) {
  if ((res.exitCode ?? 0) !== 0) return stage.criticality === 'optional' ? 'degraded' : 'failed';
  if (!rawSatisfied(stage.id)) return stage.criticality === 'optional' ? 'degraded' : 'failed';
  if (!dryRun && stage.id.startsWith('curate.') && curateItemCount(stagingDir, stage) === 0) {
    return 'suspicious-empty';
  }
  return 'ok';
}

// ---- orchestration core (pure; runStage/satisfiedFn/emit injectable) ------

export async function runPipeline({
  today,
  stagingDir = 'data/staging',
  reportsDir = 'data/reports',
  repoRoot = process.cwd(),
  mode = 'resume', // 'resume' | 'only' | 'from' | 'force'
  targets = [],
  acceptMissing = [],
  dryRun = false,
  autoRecover = false,
  runStage = spawnStage,
  satisfiedFn = defaultSatisfied,
  emit = emitLine,
} = {}) {
  if (!today) throw new Error('runPipeline: today (YYYY-MM-DD) is required');
  const order = topoOrder();
  const accepted = new Set(acceptMissing);
  const runId = readMeta(stagingDir).run_id ?? null;

  // Resolve the in-scope set + the forced (always-run) set from the mode.
  // NOTE: `--force X` re-runs ONLY X — downstream freshness is anchored to
  // collect's metadata.json mtime, not to X's output, so a downstream stage
  // stays satisfied and is skipped (e.g. `--force synthesize` will NOT rebuild
  // the report). Use `--from X` to invalidate and re-run X plus all downstream.
  let scope;
  let forced;
  if (mode === 'only') {
    scope = new Set(targets);
    forced = new Set(targets);
  } else if (mode === 'from') {
    scope = new Set(order);
    forced = new Set(targets.flatMap((t) => [t, ...downstreamOf(t)]));
  } else if (mode === 'force') {
    scope = new Set(order);
    forced = new Set(targets);
  } else {
    scope = new Set(order);
    forced = new Set();
  }

  const dryDone = new Set();
  const realSatisfied = (id) => satisfiedFn(id, { today, stagingDir, reportsDir }).satisfied;
  // In dry-run a stage counts as satisfied if it is really satisfied on disk OR we
  // have already pretended to run it — so the printed plan shows the real skips
  // plus the would-run cascade. Outside dry-run this is just realSatisfied.
  const rawSatisfied = (id) => realSatisfied(id) || (dryRun && dryDone.has(id));
  const initiallySatisfied = (id) => !forced.has(id) && rawSatisfied(id);

  // Seed state. Out-of-scope stages (e.g. collect under `--only curate.market`)
  // are treated as available so the operator's asserted upstream isn't re-run.
  const state = new Map();
  for (const id of order) {
    if (!scope.has(id)) state.set(id, 'skipped');
    else if (initiallySatisfied(id)) state.set(id, 'satisfied');
    else state.set(id, 'pending');
  }
  for (const id of order) {
    if (state.get(id) === 'satisfied') emit(buildResult(getStage(id), 'skipped', { runId }));
  }

  const depsTerminal = (id) => getStage(id).deps.every((d) => state.get(d) !== 'pending');
  const blockingDep = (id) =>
    getStage(id).deps.find(
      (d) =>
        getStage(d).criticality === 'required' && !accepted.has(d) && UNAVAILABLE.has(state.get(d)),
    );
  const requiredReady = (id) =>
    getStage(id).deps.every(
      (d) =>
        getStage(d).criticality !== 'required' || accepted.has(d) || AVAILABLE.has(state.get(d)),
    );

  // One settle pass: cascade blocks, then run each newly-ready batch until no
  // stage can progress. Mutates `state` and emits one result line per stage.
  const settle = async () => {
    let progressed = true;
    while (progressed) {
      progressed = false;

      // 1. Cascade blocks: a pending stage whose deps are all terminal but has an
      //    unavailable required dep is blocked (propagates to its dependents next pass).
      for (const id of order) {
        if (state.get(id) !== 'pending' || !depsTerminal(id)) continue;
        const dep = blockingDep(id);
        if (dep) {
          state.set(id, 'blocked');
          emit(
            buildResult(getStage(id), 'blocked', {
              runId,
              error: `required dep ${dep} is ${state.get(dep)}`,
            }),
          );
          progressed = true;
        }
      }

      // 2. Collect every pending stage whose required deps are now available.
      const ready = order.filter(
        (id) => state.get(id) === 'pending' && depsTerminal(id) && requiredReady(id),
      );
      if (ready.length === 0) continue;
      progressed = true;

      // 3. Run the batch concurrently; classify + emit each result.
      await Promise.all(
        ready.map(async (id) => {
          const stage = getStage(id);
          let res;
          if (dryRun) {
            dryDone.add(id);
            res = { exitCode: 0 };
          } else {
            res = await runStage(stage, { stagingDir, reportsDir, today, repoRoot });
          }
          const status = classify(stage, res, { rawSatisfied, stagingDir, dryRun });
          state.set(id, status);
          emit(buildResult(stage, status, { runId, ...res }));
        }),
      );
    }
  };

  await settle();

  // Bounded auto-recovery (at most one extra pass): re-run any retryable stage
  // that failed, plus its downstream (which the failure left blocked), then
  // settle again. Deterministic stages (recovery: 'none' — context/merge/
  // faithfulness) are never retried, since a re-run on identical inputs can't
  // fix them, so this pass never wastes LLM tokens on a doomed retry.
  const recovery = { attempted: false, targets: [] };
  if (autoRecover) {
    const targets = order.filter((id) => state.get(id) === 'failed' && isRetryable(id));
    if (targets.length > 0) {
      recovery.attempted = true;
      recovery.targets = targets;
      const toReset = new Set();
      for (const t of targets) {
        toReset.add(t);
        for (const d of downstreamOf(t)) if (scope.has(d)) toReset.add(d);
      }
      for (const id of toReset) {
        if (UNAVAILABLE.has(state.get(id))) state.set(id, 'pending');
      }
      console.error(`[run.js] auto-recover: retrying ${targets.join(', ')} (+ downstream)`);
      await settle();
    }
  }

  // The run is ok unless a required, non-accepted stage ended failed/blocked.
  const ok = order.every(
    (id) =>
      getStage(id).criticality !== 'required' ||
      accepted.has(id) ||
      !UNAVAILABLE.has(state.get(id)),
  );
  return { ok, state: Object.fromEntries(state), recovery };
}

// ---- CLI shim -------------------------------------------------------------

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const opts = {
    mode: 'resume',
    targets: [],
    acceptMissing: [],
    dryRun: false,
    autoRecover: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--resume') opts.mode = 'resume';
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--auto-recover') opts.autoRecover = true;
    else if (a === '--only' || a === '--from' || a === '--force') {
      opts.mode = a.slice(2);
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        i += 1;
        opts.targets.push(args[i]);
      }
    } else if (a === '--accept-missing') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        i += 1;
        opts.acceptMissing.push(args[i]);
      }
    } else {
      console.error(`[run.js] unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (opts.mode !== 'resume' && opts.targets.length === 0) {
    console.error(`[run.js] --${opts.mode} requires at least one stage`);
    process.exit(2);
  }
  for (const id of [...opts.targets, ...opts.acceptMissing]) {
    try {
      getStage(id);
    } catch {
      console.error(`[run.js] unknown stage: ${id}`);
      process.exit(2);
    }
  }
  const tz = process.env.REPORT_TIMEZONE ?? 'Asia/Taipei';
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: tz });
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  if (opts.dryRun) console.error('[run.js] DRY RUN — no stages will be spawned');
  const { ok } = await runPipeline({ today, repoRoot, ...opts });
  process.exit(ok ? 0 : 1);
}
