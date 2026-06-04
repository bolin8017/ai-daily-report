// Pure parsing of the sequencer's emitted JSON result lines into an
// observability summary for the production runner's state + monitor output.
//
// This is PRESENTATION only — control-flow recovery lives in the sequencer
// (src/pipeline/run.js --auto-recover), which decides from its in-process state,
// not from re-parsing this log. So regex/text fragility here can at worst make a
// monitor summary look wrong; it can never misroute a recovery.

/**
 * Extract every `{stage, status, ...}` JSON line from a sequencer log, in order.
 * Non-JSON lines and JSON without stage+status are ignored.
 *
 * @param {string} logText
 * @returns {Array<object>}
 */
export function parseStageResults(logText) {
  const out = [];
  for (const raw of String(logText ?? '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      obj &&
      typeof obj === 'object' &&
      typeof obj.stage === 'string' &&
      typeof obj.status === 'string'
    ) {
      out.push(obj);
    }
  }
  return out;
}

const BAD = new Set(['failed', 'blocked']);
const WARN = new Set(['degraded', 'suspicious-empty']);
const RECOVERED = new Set(['ok', 'degraded', 'suspicious-empty', 'skipped']);

/**
 * Summarize parsed records: the latest status per stage, totals, and which
 * stages failed / degraded / were auto-recovered (failed earlier, fine later).
 *
 * @param {Array<object>} records  output of parseStageResults
 * @returns {{byStage: object, order: string[], failed: string[], degraded: string[],
 *   retried: string[], totalCostUsd: number, totalTokens: number, runId: string|null,
 *   lastStage: string|null}}
 */
export function summarizeStages(records) {
  const latest = new Map();
  let totalCostUsd = 0;
  let totalTokens = 0;
  const seenFailed = new Set();
  const retried = new Set();
  for (const r of records) {
    latest.set(r.stage, r);
    // Sum across ALL records so a retried stage's first (failed) attempt cost is
    // included in total spend, not just its final attempt.
    totalCostUsd += typeof r.cost_usd === 'number' ? r.cost_usd : 0;
    totalTokens += typeof r.tokens === 'number' ? r.tokens : 0;
    if (r.status === 'failed') seenFailed.add(r.stage);
    else if (seenFailed.has(r.stage) && RECOVERED.has(r.status)) {
      retried.add(r.stage);
      seenFailed.delete(r.stage);
    }
  }
  const byStage = {};
  const failed = [];
  const degraded = [];
  for (const [stage, r] of latest) {
    byStage[stage] = {
      status: r.status,
      cost_usd: typeof r.cost_usd === 'number' ? r.cost_usd : 0,
      tokens: typeof r.tokens === 'number' ? r.tokens : 0,
      error: r.error ?? null,
    };
    if (BAD.has(r.status)) failed.push(stage);
    if (WARN.has(r.status)) degraded.push(stage);
  }
  const runId = records.reduce((acc, r) => acc ?? (r.run_id || null), null);
  return {
    byStage,
    order: [...latest.keys()],
    failed,
    degraded,
    retried: [...retried],
    totalCostUsd,
    totalTokens,
    runId,
    lastStage: records.length ? records[records.length - 1].stage : null,
  };
}

/**
 * One-line-per-stage human summary, e.g. for a Telegram failure notice.
 *
 * @param {ReturnType<typeof summarizeStages>} summary
 * @returns {string}
 */
export function formatStageSummary(summary) {
  const lines = [];
  if (summary.runId) lines.push(`repo_run_id: ${summary.runId}`);
  if (summary.retried.length) lines.push(`auto-recovered: ${summary.retried.join(', ')}`);
  for (const stage of summary.order) {
    const s = summary.byStage[stage];
    const mark = BAD.has(s.status) ? '✗' : WARN.has(s.status) ? '!' : '·';
    const err = s.error ? ` — ${s.error}` : '';
    lines.push(`${mark} ${stage}: ${s.status}${err}`);
  }
  lines.push(`total: $${summary.totalCostUsd.toFixed(4)} / ${summary.totalTokens} tok`);
  return lines.join('\n');
}
