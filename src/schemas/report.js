// Schema for data/reports/YYYY-MM-DD.json — the agent's output, consumed by 11ty templates.
//
// Why so many fields are optional and why top-level uses .passthrough():
// The agent is an LLM and its output shape drifts over time. A strict schema
// would reject valid-looking reports after minor prompt changes, blocking the
// deploy for cosmetic reasons. We keep the schema loose enough that only
// structurally broken reports (missing date, missing lead, missing signals)
// fail validation. Narrower per-field validation happens in the templates,
// where a missing field just renders as empty rather than breaking the build.

import { z } from 'zod';

const PulseItemSchema = z
  .object({
    title: z.string(),
    url: z.string().optional(),
    score: z.number().optional(),
    comments: z.number().int().nonnegative().nullable().optional(),
    takeaway: z.string().optional(),
    source: z.string().optional(),
    relevance: z.string().optional(),
    severity: z.string().optional(),
    action: z.string().optional(),
    sub: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const IdeaSchema = z
  .object({
    format: z.string().optional(),
    title: z.string(),
    projects: z
      .array(
        z.object({
          name: z.string(),
          url: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .optional(),
    description: z.string(),
    use_case: z.string().optional(),
    tech_stack: z.string().optional(),
    hardware: z.string().optional(),
    skill_level: z.string().optional(),
    dependencies: z.string().optional(),
    difficulty: z.union([z.string(), z.number()]).optional(),
    dev_time: z.string().optional(),
    first_step: z.string().optional(),
    market_evidence: z.string().optional(),
  })
  .passthrough();

const ShippedItemSchema = z
  .object({
    name: z.string(),
    url: z.string().optional(),
    desc: z.string().optional(),
    source: z.string().optional(),
    stars: z.number().nullable().optional(),
    repo_age: z.string().optional(),
  })
  .passthrough();

const SignalSchema = z
  .object({
    title: z.string(),
    body: z.string().optional(),
    evidence: z.string().optional(),
    type: z.string().optional(),
    strength: z.string().optional(),
    cross_source: z.union([z.number(), z.string()]).optional(),
    percentile: z.string().optional(),
    arc_ref: z.string().optional(),
    day_count: z.number().optional(),
    product_opportunity: z.string().optional(),
    source_links: z.array(z.union([z.string(), z.object({}).passthrough()])).optional(),
  })
  .passthrough();

const PredictionSchema = z
  .object({
    text: z.string().optional(),
    prediction: z.string().optional(),
    status: z.string().optional(),
    resolution_date: z.string().optional(),
  })
  .passthrough();

// Template reads: developer, followers, repo, url, language, hours_ago, description, local_context
const DevWatchEntrySchema = z
  .object({
    developer: z.string(),
    followers: z.number().int().nonnegative().optional(),
    repo: z.string().optional(),
    url: z.string().optional(),
    language: z.string().nullable().optional(),
    hours_ago: z.number().optional(),
    description: z.string().optional(),
    local_context: z.string().optional(),
  })
  .passthrough();

export const ReportSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dashboard: z.object({}).passthrough().optional(),
    lead: z.object({
      html: z.string(),
    }),
    ideas: z.array(IdeaSchema).min(1),
    shipped: z.array(ShippedItemSchema),
    pulse: z
      .object({
        curated: z.array(PulseItemSchema).optional(),
        hn: z.array(PulseItemSchema).optional(),
        lobsters: z.array(PulseItemSchema).optional(),
      })
      .passthrough(),
    dev_watch: z
      .object({
        taiwan: z.array(DevWatchEntrySchema).optional(),
        global: z.array(DevWatchEntrySchema).optional(),
      })
      .passthrough()
      .optional(),
    signals: z.array(SignalSchema),
    sleeper: z.object({}).passthrough().optional(),
    contrarian: z.object({}).passthrough().optional(),
    predictions: z.array(PredictionSchema).optional(),
    prediction_updates: z.array(z.unknown()).optional(),
    tracked_topics: z.record(z.string(), z.unknown()).optional(),
    rss_context: z.unknown().optional(),
    sources_status: z.union([z.string(), z.array(z.unknown())]).optional(),
    memory_status: z.unknown().optional(),
    archive: z.unknown().optional(),
  })
  .passthrough();
