import { z } from 'zod';

export const ArxivPaperSchema = z
  .object({
    paper_id: z.string().nullable(),
    url: z.string().url(),
    title: z.string().min(1),
    abstract: z.string(),
    authors: z.array(z.string()),
    categories: z.array(z.string()),
    published: z.string().nullable(),
  })
  .passthrough();
