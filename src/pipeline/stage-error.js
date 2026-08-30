// Why a failed stage failed, recovered from the artifacts the stage already
// wrote. The sequencer records one `error` per stage and the production notice
// prints it verbatim (production-run.js renderStages), but nothing ever filled
// it in for a `failed` stage — spawnStage returned only an exit code — so both
// the 2026-08-26 and 08-27 outages paged as a bare "FAILED" while
// `curated/.logs/<section>.raw.json` held the actual cause ("Failed to
// authenticate: OAuth session expired and could not be refreshed").
//
// Best-effort by construction: every read is guarded and the exit code is always
// an acceptable answer. Observability must never be the thing that aborts a run.

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const MAX_CHARS = 300;

// Per stage, the artifacts worth reading, most-recent attempt first. `envelope`
// entries are `claude -p --output-format json` result envelopes (the .txt/.raw
// suffixes are historical — the content is JSON); `stderr` entries are raw text.
function artifactsFor(stageId) {
  if (stageId.startsWith('curate.')) {
    const s = stageId.slice('curate.'.length);
    return [
      { kind: 'envelope', file: `${s}.repair-raw.json` },
      { kind: 'stderr', file: `${s}.err.txt.repair` },
      { kind: 'stderr', file: `${s}.err.txt.validate` },
      { kind: 'envelope', file: `${s}.raw.json` },
      { kind: 'stderr', file: `${s}.err.txt` },
      { kind: 'stderr', file: `${s}.err.txt.prompt` },
    ];
  }
  if (stageId === 'synthesize') {
    return [
      { kind: 'envelope', file: 'synthesizer.raw.txt' },
      { kind: 'stderr', file: 'synthesizer.err.txt' },
    ];
  }
  if (stageId === 'faithfulness') {
    return [
      { kind: 'envelope', file: 'faithfulness.verdicts.json.raw' },
      { kind: 'stderr', file: 'faithfulness.err.txt' },
    ];
  }
  return [];
}

// One bounded single-line summary. Stage errors travel through a Telegram
// notice and a JSON state file, so a stack trace has to arrive as a line.
function condense(text) {
  const line = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (line.length <= MAX_CHARS) return line;
  return `${line.slice(0, MAX_CHARS - 1)}…`;
}

function readFresh(file, sinceMs) {
  try {
    if (sinceMs > 0 && statSync(file).mtimeMs < sinceMs) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function messageFrom(artifact, body) {
  if (artifact.kind !== 'envelope') return condense(body);
  let env;
  try {
    env = JSON.parse(body);
  } catch {
    return '';
  }
  // A clean envelope is not evidence of anything — the stage may have failed
  // after claude returned. Only an errored envelope explains the exit code.
  if (env?.is_error !== true) return '';
  return condense(env.result);
}

/**
 * Best-effort cause of a stage's failure, for the run state's `error` field.
 *
 * @param {string} stagingDir - pipeline staging dir (holds curated/.logs)
 * @param {string} stageId
 * @param {object} opts
 * @param {number} opts.exitCode - the stage's exit code; the always-valid fallback
 * @param {number} [opts.sinceMs=0] - ignore artifacts older than this (epoch ms),
 *   so a previous run's leftovers can't be reported as this run's cause
 * @returns {string} never empty
 */
export function stageFailureReason(stagingDir, stageId, { exitCode, sinceMs = 0 }) {
  const logDir = path.join(stagingDir, 'curated', '.logs');
  for (const artifact of artifactsFor(stageId)) {
    const body = readFresh(path.join(logDir, artifact.file), sinceMs);
    if (body == null) continue;
    const message = messageFrom(artifact, body);
    if (message) return message;
  }
  return `exit ${exitCode}`;
}
