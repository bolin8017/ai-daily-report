// Schema for data/staging/metadata.json — the contract between Stage 1
// (src/collect.js) and Stage 2 (scripts/analyze.sh).

import { z } from 'zod';

const SourceHealthSchema = z.object({
  ok: z.boolean(),
  count: z.number().int().nonnegative(),
});

export const StagingMetadataSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  collected_at: z.string(),
  timezone: z.string(),
  sources: z.object({
    feeds: SourceHealthSchema,
    trending: SourceHealthSchema,
    search: SourceHealthSchema,
    developers: SourceHealthSchema,
  }),
  // Sources that returned ok:false or had zero items — surfaced to Stage 2
  // so the agent can note data gaps in the report.
  degraded: z.array(z.string()).default([]),
});
