import { z } from 'zod';

export const HFModelSchema = z
  .object({
    id: z.string(),
    url: z.string().url(),
    downloads: z.number().int().nullable(),
    likes: z.number().int().nullable(),
    last_modified: z.string().nullable(),
    tags: z.array(z.string()),
    pipeline_tag: z.string().nullable(),
  })
  .passthrough();
