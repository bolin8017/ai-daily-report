// Assemble the report.meta observability block from per-stage usage records
// (parsed via claude-envelope.js) plus the Stage-1 staging identity/health.
// Pure — file IO happens in the caller (scripts/merge-report.sh).

export function aggregateTotals(stages) {
  let cost = 0;
  let tokens = 0;
  let sawCost = false;
  let sawTokens = false;
  for (const s of Object.values(stages)) {
    if (typeof s.cost_usd === 'number') {
      cost += s.cost_usd;
      sawCost = true;
    }
    for (const key of ['input_tokens', 'output_tokens']) {
      if (Number.isInteger(s[key])) {
        tokens += s[key];
        sawTokens = true;
      }
    }
  }
  return {
    total_cost_usd: sawCost ? cost : undefined,
    total_tokens: sawTokens ? tokens : undefined,
  };
}

export function aggregateMeta({
  stagingMeta = {},
  stages = {},
  model,
  generatedAt,
  analyzeDurationMs,
} = {}) {
  const meta = {};
  if (stagingMeta.run_id) meta.run_id = stagingMeta.run_id;
  if (stagingMeta.pipeline_version) meta.pipeline_version = stagingMeta.pipeline_version;
  if (model) meta.model = model;
  if (generatedAt) meta.generated_at = generatedAt;
  if (Number.isInteger(analyzeDurationMs)) meta.analyze_duration_ms = analyzeDurationMs;
  if (stagingMeta.sources) meta.source_health = stagingMeta.sources;
  if (stagingMeta.feeds_sections) meta.feeds_sections = stagingMeta.feeds_sections;
  if (Array.isArray(stagingMeta.degraded)) meta.degraded_sources = stagingMeta.degraded;
  if (Object.keys(stages).length > 0) {
    meta.stages = stages;
    const { total_cost_usd, total_tokens } = aggregateTotals(stages);
    if (total_cost_usd !== undefined) meta.total_cost_usd = total_cost_usd;
    if (total_tokens !== undefined) meta.total_tokens = total_tokens;
  }
  return Object.keys(meta).length > 0 ? meta : null;
}
