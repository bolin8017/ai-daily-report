// Schema for a single lens entry in config.json → lenses[].
// Each lens triple (config + prompt file + output paths) is validated here.
// Stage 2 fan-out reads lenses[] and runs claude -p once per enabled lens.

import { z } from 'zod';
import { SourceSchema } from './source.js';

export const LensConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    enabled: z.boolean().default(true),
    // critical=true: validation failure aborts deploy (used by ai-builder).
    // critical=false: failure logs degraded, deploy continues with last-good
    //                 output for this lens (used by phison-aidaptiv et al).
    critical: z.boolean().default(false),
    prompt_file: z.string(),
    sources_overlay: z
      .object({
        // Lens-specific source descriptors merged on top of the base registry.
        // Same shape as src/sources/registry.js entries.
        sources: z.array(SourceSchema).optional(),
        github_topics: z
          .object({
            topics: z.array(z.string()).optional(),
            limit_per_topic: z.number().int().positive().optional(),
          })
          .optional(),
      })
      .optional(),
    rotation: z
      .object({
        starvation_threshold_days: z.number().int().positive().default(7),
      })
      .optional(),
    output_paths: z
      .object({
        // Templates supporting {id} and {date} placeholders, resolved at Stage 2.
        report: z.string(),
        memory: z.string(),
      })
      .optional(),
  })
  .passthrough();
