// Schema for data/staging/editorial.json — the LLM-written subset of the
// daily report produced by Stage 3 (synthesize) under FEATURE_MERGE_STEP=1.
//
// The synthesizer writes ONLY editorial.json + memory.json. A subsequent
// merge step (src/lib/merge.js) composes the final data/reports/<date>.json
// by combining editorial with the curated/*.json outputs from Stage 2.
//
// schema_version is the string "2.1-editorial" (not the numeric 2.1 used
// in the composed report) to make file-level type checks unambiguous.

import { z } from 'zod';
import { IdeaItem, PredictionItem, SignalItem } from './items.js';

const SignalsBlock = z.object({
  focus: z.array(SignalItem),
  sleeper: SignalItem.optional(),
  contrarian: SignalItem.optional(),
  predictions: z.array(PredictionItem),
  prediction_updates: z.array(PredictionItem).optional(),
});

const IdeationBlock = z.object({
  general: z.array(IdeaItem),
  work: z.array(IdeaItem),
});

export const EditorialSchema = z
  .object({
    schema_version: z.literal('2.1-editorial'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    theme: z.string(),
    lead: z.object({ html: z.string() }),
    signals: SignalsBlock,
    ideation: IdeationBlock,
  })
  .passthrough();
