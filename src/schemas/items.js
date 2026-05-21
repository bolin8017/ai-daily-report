// Item-level schemas. All extend ItemBase (id required, audience optional with
// default 'general'). Each item type uses .passthrough() so the LLM can add
// auxiliary fields without breaking validation.

import { z } from 'zod';

export const AudienceTag = z.enum(['general', 'work', 'both']);

export const ItemBase = z
  .object({
    id: z.string(),
    audience: AudienceTag.default('general'),
    url: z.string().optional(),
    source: z.string().optional(),
  })
  .passthrough();

export const ShippedItem = ItemBase.extend({
  name: z.string(),
  desc: z.string().optional(),
  stars: z.number().nullable().optional(),
  repo_age: z.string().optional(),
  language: z.string().nullable().optional(),
  relevance: z.string().optional(),
  topic_match: z.array(z.string()).optional(),
});

export const PulseItem = ItemBase.extend({
  title: z.string(),
  score: z.number().optional(),
  comments: z.number().int().nullable().optional(),
  takeaway: z.string().optional(),
});

export const MarketItem = ItemBase.extend({
  title: z.string(),
  takeaway: z.string().optional(),
  amount: z.string().optional(),
  companies: z.array(z.string()).optional(),
  region: z.string().optional(),
});

export const TechItem = ItemBase.extend({
  title: z.string(),
  takeaway: z.string().optional(),
  benchmark_changes: z
    .object({
      new_top_5: z.array(z.string()).optional(),
      rank_changes: z.array(z.string()).optional(),
    })
    .optional(),
});

export const IdeaItem = z
  .object({
    id: z.string(),
    audience: AudienceTag,
    title: z.string(),
    description: z.string(),
    format: z.string().optional(),
    projects: z
      .array(
        z.object({
          name: z.string(),
          url: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .optional(),
    use_case: z.string().optional(),
    tech_stack: z.string().optional(),
    hardware: z.string().optional(),
    skill_level: z.string().optional(),
    dev_time: z.string().optional(),
    first_step: z.string().optional(),
    market_evidence: z.string().optional(),
    source_links: z.array(z.string()).optional(),
  })
  .passthrough();

export const SignalItem = z
  .object({
    id: z.string(),
    title: z.string(),
    body: z.string().optional(),
    mechanism: z.string().optional(),
    evidence: z.string().optional(),
    cross_source: z.number().optional(),
    product_opportunity: z.string().optional(),
    source_links: z.array(z.string()).optional(),
  })
  .passthrough();

export const PredictionItem = z
  .object({
    id: z.string(),
    text: z.string(),
    resolution_date: z.string(),
    status: z.enum(['pending', 'resolved-yes', 'resolved-no', 'unverifiable']).default('pending'),
    rationale: z.string().optional(),
  })
  .passthrough();
