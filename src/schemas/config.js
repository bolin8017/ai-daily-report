// Schema for config.json. Validated once at import time by src/lib/config.js
// (ConfigSchema.parse) — callers receive an already-validated, frozen object.
// Also available standalone via `npm run validate:config`.
//
// config.json is currently an empty placeholder: the former `providers` /
// `report` fields were validated but read by no code (the firecrawl / jina
// providers hardcode their own constants), so editing them silently did
// nothing. They were removed 2026-07-21; `.strict()` makes a stale
// config.json that still carries them fail loudly at startup instead.
// Persona, voice, source list, section definitions, and theme overlays all
// live in themes/<theme>/; env-level knobs live in .env (see .env.example).

import { z } from 'zod';

export const ConfigSchema = z.object({}).strict();
