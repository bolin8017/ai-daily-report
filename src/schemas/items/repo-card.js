import { z } from 'zod';

export const RepoCardSchema = z.object({
  full_name: z.string().regex(/^[^/]+\/[^/]+$/),
  url: z.string().url(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  stars_today: z.number().int().nullable().optional(),
  forks: z.number().int().nonnegative().optional(),
  topics: z.array(z.string()).optional(),
  readme_excerpt: z.string().optional(),
  rank: z.number().int().positive().optional(),
});
