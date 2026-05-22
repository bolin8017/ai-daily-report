import { z } from 'zod';

export const HNStorySchema = z.object({
  source: z.literal('hackernews'),
  title: z.string().min(1),
  url: z.string().url(),
  hn_url: z.string().url(),
  hn_id: z.string().regex(/^\d+$/),
  author: z.string(),
  published: z.string().nullable(),
  rank: z.number().int().positive(),
  score: z.number().int().optional(),
  num_comments: z.number().int().optional(),
  comments: z
    .array(
      z.object({
        text: z.string(),
        score: z.number().int(),
        by: z.string(),
      }),
    )
    .optional(),
});
