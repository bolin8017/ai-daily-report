import { z } from 'zod';

export const MopsDisclosureSchema = z.object({
  ticker: z.string(),
  ticker_name: z.string().nullable(),
  disclosure_date: z.string().nullable(),
  statement_date: z.string().nullable(),
  statement_time: z.string().nullable(),
  headline: z.string(),
  basis: z.string().nullable(),
  fact_date: z.string().nullable(),
  detail: z.string(),
  url: z.string().url(),
});
