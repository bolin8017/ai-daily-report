import { z } from 'zod';

export const DiscoveryCandidate = z
  .object({
    full_name: z.string(),
    url: z.string(),
    description: z.string().nullable().optional(),
    readme_excerpt: z.string().nullable().optional(),
    stars: z.number().nullable().optional(),
    stars_today: z.number().nullable().optional(),
    velocity_per_day: z.number().nullable().optional(),
    repo_age_days: z.number().nullable().optional(),
    eng_score: z.number().nullable().optional(),
    eng_signals: z.record(z.any()).nullable().optional(),
    validation_refs: z.array(z.string()).optional(),
    excellence_score: z.number().nullable().optional(),
    source: z.string().optional(),
  })
  .passthrough();

// A repo one of the three gates dropped. `detail` carries whatever the gate
// judged on — for velocity that is the full input set, so the verdict can be
// recomputed against a changed gate without the candidate pool, which exists
// only in collect's memory.
export const DiscoveryRejection = z
  .object({
    full_name: z.string(),
    stars: z.number().nullable().optional(),
    gate: z.enum(['free', 'velocity', 'engineering']),
    reason: z.string(),
    detail: z.record(z.any()).optional(),
  })
  .passthrough();

export const DiscoveriesStagingSchema = z.object({
  ok: z.boolean(),
  generated_at: z.string(),
  candidates: z.array(DiscoveryCandidate),
  watchlist: z.array(DiscoveryCandidate),
  rejected: z.array(DiscoveryRejection),
  stats: z
    .object({
      pool: z.number(),
      survivors: z.number(),
      watchlisted: z.number(),
      rejected: z.number(),
    })
    .passthrough(),
});
