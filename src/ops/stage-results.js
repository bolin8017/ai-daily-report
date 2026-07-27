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
 * stages failed / degraded / had a retry attempted / were auto-recovered.
 *
 * `attempted` = a stage that failed at least once and then has any later record
 * (the auto-recover retry ran, regardless of outcome). `retried` ⊆ `attempted`
 * and narrows to the ones that recovered (failed earlier, fine later). The split
 * matters for triage: a doomed retry (failed twice, like the 2026-06-22 529)
 * shows in `attempted` but not `retried`, so the state file reveals the one
 * retry was already spent without grepping the run log.
 *
 * @param {Array<object>} records  output of parseStageResults
 * @returns {{byStage: object, order: string[], failed: string[], degraded: string[],
 *   attempted: string[], retried: string[], rerolled: string[], totalCostUsd: number,
 *   totalTokens: number, runId: string|null, lastStage: string|null}}
 */
export function summarizeStages(records) {
  const latest = new Map();
  let totalCostUsd = 0;
  let totalTokens = 0;
  const seenFailed = new Set();
  const everFailed = new Set();
  const everEmpty = new Set();
  const attempted = new Set();
  const retried = new Set();
  const rerolled = new Set();
  for (const r of records) {
    latest.set(r.stage, r);
    // Sum across ALL records so a retried stage's first (failed) attempt cost is
    // included in total spend, not just its final attempt.
    totalCostUsd += typeof r.cost_usd === 'number' ? r.cost_usd : 0;
    totalTokens += typeof r.tokens === 'number' ? r.tokens : 0;
    // A record for a stage that already failed on a PRIOR record means the
    // auto-recover retry ran — count it regardless of this record's outcome.
    if (everFailed.has(r.stage)) attempted.add(r.stage);
    // A record after a PRIOR suspicious-empty record means the empty re-roll
    // ran (dr-6: it emits no `failed` record, so it was invisible in the
    // retry accounting) — track it separately, whatever the outcome.
    if (everEmpty.has(r.stage)) rerolled.add(r.stage);
    if (r.status === 'suspicious-empty') everEmpty.add(r.stage);
    if (r.status === 'failed') {
      everFailed.add(r.stage);
      seenFailed.add(r.stage);
    } else if (seenFailed.has(r.stage) && RECOVERED.has(r.status)) {
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
    attempted: [...attempted],
    retried: [...retried],
    rerolled: [...rerolled],
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
  const failedRetries = (summary.attempted ?? []).filter((s) => !summary.retried.includes(s));
  if (failedRetries.length) lines.push(`retry attempted (failed): ${failedRetries.join(', ')}`);
  if (summary.rerolled?.length) lines.push(`empty re-rolled: ${summary.rerolled.join(', ')}`);
  for (const stage of summary.order) {
    const s = summary.byStage[stage];
    const mark = BAD.has(s.status) ? '✗' : WARN.has(s.status) ? '!' : '·';
    const err = s.error ? ` — ${s.error}` : '';
    lines.push(`${mark} ${stage}: ${s.status}${err}`);
  }
  lines.push(`total: $${summary.totalCostUsd.toFixed(4)} / ${summary.totalTokens} tok`);
  return lines.join('\n');
}
