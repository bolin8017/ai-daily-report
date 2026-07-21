// Resume cache check: is a stage's output already present, parseable, and from
// THIS run? Anchored to collect's metadata.json (written first each run), so a
// new day's collect invalidates yesterday's downstream outputs automatically and
// a same-day re-run skips the stages that already finished. fs reads only — no
// process/exec — so it is pure enough to unit-test. The sequencer (later phase)
// calls this to avoid recomputing a finished expensive `claude -p` stage.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { getStage } from './stages.js';

function mtimeMs(p) {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * @param {string} stageId
 * @param {object} opts
 * @param {string} opts.today 'YYYY-MM-DD' — the run anchor day
 * @param {string} [opts.stagingDir] default 'data/staging'
 * @param {string} [opts.reportsDir] default 'data/reports'
 * @returns {{satisfied: boolean, reason: 'ok'|'missing'|'invalid'|'stale'|'wrong-day'|'unaudited'}}
 */
export function satisfied(
  stageId,
  { today, stagingDir = 'data/staging', reportsDir = 'data/reports' } = {},
) {
  if (!today) throw new Error('satisfied: today (YYYY-MM-DD) is required');
  const stage = getStage(stageId);
  const anchor = path.join(stagingDir, 'metadata.json');

  switch (stage.satisfiedCheck) {
    case 'today-metadata': {
      const m = readJson(anchor);
      if (m === undefined) return { satisfied: false, reason: 'missing' };
      if (m === null || typeof m !== 'object' || Array.isArray(m) || typeof m.date !== 'string') {
        return { satisfied: false, reason: 'invalid' };
      }
      return m.date === today
        ? { satisfied: true, reason: 'ok' }
        : { satisfied: false, reason: 'wrong-day' };
    }
    case 'fresh-outputs': {
      const anchorMtime = mtimeMs(anchor);
      if (anchorMtime === null) return { satisfied: false, reason: 'missing' };
      for (const rel of stage.outputs) {
        const p = path.join(stagingDir, rel);
        const m = mtimeMs(p);
        if (m === null) return { satisfied: false, reason: 'missing' };
        if (rel.endsWith('.json') && readJson(p) === undefined) {
          return { satisfied: false, reason: 'invalid' };
        }
        if (m < anchorMtime) return { satisfied: false, reason: 'stale' };
      }
      return { satisfied: true, reason: 'ok' };
    }
    case 'editorial-audited': {
      const p = path.join(stagingDir, 'editorial.json');
      const editorial = readJson(p);
      if (editorial === undefined) return { satisfied: false, reason: 'missing' };
      // Staleness anchor (mirrors report-for-day): a leftover editorial from a
      // PRIOR run still carries its faithfulness key, but THIS run's synthesize
      // will overwrite it un-audited. Without anchoring to the run's metadata
      // mtime, content-presence alone wrongly marks faithfulness satisfied — so
      // it gets skipped every other day and ships an un-audited editorial.
      const anchorMtime = mtimeMs(anchor);
      const m = mtimeMs(p);
      if (anchorMtime !== null && m !== null && m < anchorMtime) {
        return { satisfied: false, reason: 'stale' };
      }
      return editorial.faithfulness != null
        ? { satisfied: true, reason: 'ok' }
        : { satisfied: false, reason: 'unaudited' };
    }
    case 'report-for-day': {
      const p = path.join(reportsDir, `${today}.json`);
      const m = mtimeMs(p);
      if (m === null) return { satisfied: false, reason: 'missing' };
      if (readJson(p) === undefined) return { satisfied: false, reason: 'invalid' };
      const anchorMtime = mtimeMs(anchor);
      // no anchor on disk = no stale evidence; trust the existing report
      if (anchorMtime !== null && m < anchorMtime) return { satisfied: false, reason: 'stale' };
      return { satisfied: true, reason: 'ok' };
    }
    default:
      throw new Error(
        `satisfied: unhandled satisfiedCheck '${stage.satisfiedCheck}' for ${stageId}`,
      );
  }
}
