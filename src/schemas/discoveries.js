import { z } from 'zod';

export const DiscoveryCandidate = z
  .object({
    full_name: z.string(),
    url: z.string(),
    stars: z.number().nullable().optional(),
    stars_today: z.number().nullable().optional(),
    velocity_per_day: z.number().nullable().optional(),
    repo_age_days: z.number().nullable().optional(),
    eng_score: z.number().nullable().optional(),
    eng_signals: z.record(z.any()).optional(),
    validation_refs: z.array(z.string()).optional(),
    excellence_score: z.number().nullable().optional(),
    source: z.string().optional(),
  })
  .passthrough();

export const DiscoveriesStagingSchema = z.object({
  ok: z.boolean(),
  generated_at: z.string(),
  candidates: z.array(DiscoveryCandidate),
  watchlist: z.array(DiscoveryCandidate),
  stats: z.object({ pool: z.number(), survivors: z.number(), watchlisted: z.number() }).passthrough(),
});
