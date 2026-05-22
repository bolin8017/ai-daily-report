import { z } from 'zod';

export const RSSPostSchema = z
  .object({
    source: z.string(),
    category: z.string().optional(),
    title: z.string().min(1),
    url: z.string().url(),
    description: z.string().optional(),
    author: z.string().optional().default(''),
    published: z.string().nullable(),
    tags: z.array(z.string()).optional(),
    rank: z.number().int().positive(),
  })
  .passthrough();
