// Schema for data/reports/YYYY-MM-DD.json (v2.0 — unified function-based IA).
//
// Strictness layering: section sub-groups are strict (named fields, arrays
// always present) so templates can iterate without guarding; individual items
// use .passthrough() so LLM auxiliary-field drift doesn't break the build.
// Top-level uses .passthrough() for forward compatibility.
//
// Old v1.x reports lack schema_version — templates use conditional partials
// (site/index.njk routes v2 → v2/unified.njk, otherwise legacy lens UI).

import { z } from 'zod';
import {
  IdeaItem,
  MarketItem,
  PredictionItem,
  PulseItem,
  ShippedItem,
  SignalItem,
  TechItem,
} from './items.js';

// Observability block. Populated by scripts/merge-report.sh in the new
// pipeline (and the legacy lens path). All fields optional so a
// best-effort / partial meta never aborts the composed-report validation.
const StageUsageSchema = z
  .object({
    model: z.string().optional(),
    cost_usd: z.number().nonnegative().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    num_turns: z.number().int().nonnegative().optional(),
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cache_creation_tokens: z.number().int().nonnegative().optional(),
    is_error: z.boolean().optional(),
    session_id: z.string().optional(),
  })
  .passthrough();

const ReportMetaSchema = z
  .object({
    run_id: z.string().uuid().optional(),
    pipeline_version: z.string().optional(),
    model: z.string().optional(),
    generated_at: z.string().optional(),
    analyze_duration_ms: z.number().int().nonnegative().optional(),
    source_health: z
      .record(z.string(), z.object({ ok: z.boolean(), count: z.number().int().nonnegative() }))
      .optional(),
    degraded_sources: z.array(z.string()).optional(),
    stages: z.record(z.string(), StageUsageSchema).optional(),
    total_cost_usd: z.number().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const SignalsSection = z.object({
  focus: z.array(SignalItem),
  sleeper: SignalItem.optional(),
  contrarian: SignalItem.optional(),
  predictions: z.array(PredictionItem),
  prediction_updates: z.array(PredictionItem).optional(),
});

const IdeationSection = z.object({
  general: z.array(IdeaItem),
  work: z.array(IdeaItem),
});

const ShippedSection = z.object({
  trending: z.array(ShippedItem).optional(),
  topic_discovery: z.array(ShippedItem).optional(),
  dev_watch_taiwan: z.array(ShippedItem).optional(),
  dev_watch_global: z.array(ShippedItem).optional(),
});

const PulseSection = z.object({
  hn: z.array(PulseItem).optional(),
  lobsters: z.array(PulseItem).optional(),
  chinese_community: z.array(PulseItem).optional(),
  ai_bloggers: z.array(PulseItem).optional(),
});

const MarketSection = z.object({
  ma: z.array(MarketItem).optional(),
  funding: z.array(MarketItem).optional(),
  policy: z.array(MarketItem).optional(),
  taiwan: z.array(MarketItem).optional(),
});

const TechSection = z.object({
  vendor: z.array(TechItem).optional(),
  models: z.array(TechItem).optional(),
  benchmarks: z.array(TechItem).optional(),
  aidaptiv: z.array(TechItem).optional(),
});

export const ReportSchema = z
  .object({
    // Accept both 2 (v2.0) and 2.1 (post-2026-05-24 editorial/merge split).
    // Must stay in sync with buildReportSchema() below — validate.js uses
    // this static schema, merge.js uses the dynamic one; a literal(2) here
    // silently rejected every 2.1 report once validate.js stopped skipping it.
    schema_version: z.union([z.literal(2), z.literal(2.1)]),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    meta: ReportMetaSchema.optional(),
    lead: z.object({ html: z.string() }),
    signals: SignalsSection,
    ideation: IdeationSection,
    shipped: ShippedSection,
    pulse: PulseSection,
    market: MarketSection,
    tech: TechSection,
  })
  .passthrough();

// Dynamic ReportSchema composer. Reads the active theme's manifest +
// per-section schemas to build a Zod schema that matches the composed
// v2.1 report shape. Adding / removing a section is a folder-level
// operation in themes/<theme>/sections/.
import { ACTIVE_THEME } from '../lib/config.js';
import { listActiveSections } from '../lib/theme.js';

export async function buildReportSchema(themeName = ACTIVE_THEME) {
  const sections = await listActiveSections(themeName);
  const sectionShapes = {};
  for (const sec of sections) {
    const mod = await import(`../../themes/${themeName}/sections/${sec.id}/schema.js`);
    sectionShapes[sec.id] = mod.sectionSchema;
  }
  return z
    .object({
      // Accepts legacy v2 reports (literal 2) and post-cutover v2.1 reports.
      // Legacy 2 reports remain renderable until they age out of the
      // 60-day hot window (current hot reports are pre-cutover).
      schema_version: z.union([z.literal(2), z.literal(2.1)]),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      meta: ReportMetaSchema.optional(),
      lead: z.object({ html: z.string() }),
      signals: SignalsSection,
      ideation: IdeationSection,
      ...sectionShapes,
    })
    .passthrough();
}

// Always returns the composed schema; the previous flag-gated static
// fallback is gone after Phase 4 cleanup.
export async function resolveReportSchema() {
  return buildReportSchema();
}
