// Parse a `claude -p --output-format json` result envelope into a normalized
// per-stage usage record for report.meta.stages. Best-effort: every field is
// optional and malformed input degrades to a minimal record rather than
// throwing — observability must never abort the pipeline.
//
// Dual-mode (mirrors src/lib/condense.js):
//   import { parseEnvelope } from './claude-envelope.js'
//   node src/lib/claude-envelope.js sidecar <rawPath> <outPath> <stage>
//   node src/lib/claude-envelope.js result  <rawPath>      # prints .result text

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function asInt(v) {
  if (Number.isInteger(v)) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  return undefined;
}

export function parseEnvelope(env, stageName) {
  const rec = { stage: stageName };
  if (!env || typeof env !== 'object') {
    rec.is_error = true;
    return rec;
  }
  const u = env.usage && typeof env.usage === 'object' ? env.usage : {};
  if (typeof env.total_cost_usd === 'number') rec.cost_usd = env.total_cost_usd;
  if (asInt(env.duration_ms) !== undefined) rec.duration_ms = asInt(env.duration_ms);
  if (asInt(env.num_turns) !== undefined) rec.num_turns = asInt(env.num_turns);
  if (asInt(u.input_tokens) !== undefined) rec.input_tokens = asInt(u.input_tokens);
  if (asInt(u.output_tokens) !== undefined) rec.output_tokens = asInt(u.output_tokens);
  if (asInt(u.cache_read_input_tokens) !== undefined)
    rec.cache_read_tokens = asInt(u.cache_read_input_tokens);
  if (asInt(u.cache_creation_input_tokens) !== undefined)
    rec.cache_creation_tokens = asInt(u.cache_creation_input_tokens);
  if (typeof env.is_error === 'boolean') rec.is_error = env.is_error;
  if (typeof env.session_id === 'string') rec.session_id = env.session_id;
  if (typeof env.model === 'string') rec.model = env.model;
  return rec;
}

function readEnvelope(rawPath) {
  try {
    return JSON.parse(readFileSync(rawPath, 'utf8'));
  } catch {
    return null;
  }
}

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();

if (isMain) {
  const [mode, rawPath, outPath, stage] = process.argv.slice(2);
  const env = rawPath ? readEnvelope(rawPath) : null;
  if (mode === 'sidecar') {
    const rec = env ? parseEnvelope(env, stage) : { stage, is_error: true };
    try {
      writeFileSync(outPath, `${JSON.stringify(rec, null, 2)}\n`);
    } catch {
      // best-effort: never fail the pipeline over observability
    }
  } else if (mode === 'result') {
    process.stdout.write(env && typeof env.result === 'string' ? env.result : '');
  }
}
