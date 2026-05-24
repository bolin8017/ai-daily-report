// Schema for config.json. Validated once at import time by src/lib/config.js
// (ConfigSchema.parse) — callers receive an already-validated, frozen object.
// Also available standalone via `npm run validate:config`.
//
// Post-cutover, config.json holds only environment-level tuning (cloud-fallback
// provider knobs + report rendering settings). Persona, voice, source list,
// section definitions, and theme overlays all live in themes/<theme>/.

import { z } from 'zod';

export const ConfigSchema = z.object({
  // Cloud-fallback provider tuning. Optional with sensible defaults.
  providers: z
    .object({
      firecrawl: z
        .object({
          monthly_cap: z.number().int().positive().default(500),
          enabled_in_local_dev: z.boolean().default(false),
        })
        .optional(),
      jina_reader: z
        .object({
          base_url: z.string().url().default('https://r.jina.ai'),
        })
        .optional(),
    })
    .optional(),
  report: z.object({
    language: z.string(),
    max_featured_items: z.number().int().positive(),
    style: z.string(),
  }),
});
