// Schema for data/staging/metadata.json — the contract between Stage 1
// (src/collect.js) and Stage 2 (scripts/analyze.sh).

import { z } from 'zod';

const SourceHealthSchema = z.object({
  ok: z.boolean(),
  count: z.number().int().nonnegative(),
});

export const StagingMetadataSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Per-run identifier so a given pipeline execution can be traced across
  // Stage 1 logs, Stage 2 logs, the committed report, and git commits.
  // Optional so Stage 2 still validates old staging data (pre-upgrade) —
  // analyze.sh skips the meta block when these are missing.
  run_id: z.string().uuid().optional(),
  // Short git SHA of the code that produced this run — lets you correlate
  // a bad report with the exact commit that generated it.
  pipeline_version: z.string().optional(),
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
