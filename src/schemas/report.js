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

// Observability block injected by scripts/analyze.sh after the agent finishes.
const ReportMetaSchema = z.object({
  run_id: z.string().uuid(),
  pipeline_version: z.string(),
  model: z.string(),
  generated_at: z.string(),
  analyze_duration_ms: z.number().int().nonnegative(),
  source_health: z.record(
    z.string(),
    z.object({ ok: z.boolean(), count: z.number().int().nonnegative() }),
  ),
  degraded_sources: z.array(z.string()),
});

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
    schema_version: z.literal(2),
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
