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

// Several auxiliary fields (amount, repo_age, etc.) are documented as strings
// in the curator prompts but Haiku occasionally returns a raw number ("365"
// → 365) or null. Templates only stringify them for display, so accepting all
// three is harmless and avoids a hard pipeline abort on cosmetic LLM drift.
const StringNumberOrNull = z.union([z.string(), z.number(), z.null()]).optional();

export const ShippedItem = ItemBase.extend({
  name: z.string(),
  desc: z.string().optional(),
  stars: z.number().nullable().optional(),
  repo_age: StringNumberOrNull,
  language: z.string().nullable().optional(),
  relevance: z.string().optional(),
  topic_match: z.array(z.string()).optional(),
});

export const CatalogItem = ItemBase.extend({
  name: z.string(),
  stars: z.number().nullable().optional(),
  language: z.string().nullable().optional(),
  category: z.enum(['ai', 'general']).default('ai'),
  takeaway: z.string().optional(),
});

export const PulseItem = ItemBase.extend({
  title: z.string(),
  score: z.number().nullable().optional(),
  comments: z.number().int().nullable().optional(),
  takeaway: z.string().optional(),
});

export const MarketItem = ItemBase.extend({
  title: z.string(),
  takeaway: z.string().optional(),
  amount: StringNumberOrNull,
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

export const SignalItem = z
  .object({
    // id is recommended but not required — synthesized signals (focus/sleeper/
    // contrarian) don't always need cross-tab anchors. Templates fall back to
    // index-based anchors when id is missing.
    id: z.string().optional(),
    // title is the only structural field templates need to render the card.
    // For contrarian/sleeper, body+evidence may carry the primary content
    // (LLM occasionally puts the headline into body instead of title).
    title: z.string().optional(),
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
