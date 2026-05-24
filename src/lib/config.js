// Validated config singleton. Import this instead of reading config.json
// directly — validation runs once at module load so every consumer gets the
// same parsed + frozen object and malformed config fails loudly at startup.
//
// Source descriptors live in src/sources/registry.js (the data layer).
// Lens overlay merging happens in src/lib/sources.js → getEffectiveSources().
// config.json now only holds environment/tuning knobs (rsshub_urls, github
// topics + developers config, lens definitions, provider tuning, report).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema } from '../schemas/config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config.json');

const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const parsed = ConfigSchema.parse(raw);

export default Object.freeze(parsed);

// Phase 1 of pipeline redesign — feature flag for theme bundle paths.
// When 1, the pipeline reads prompts / sources / sections from
// themes/$ACTIVE_THEME/ instead of .claude/* and config.json.
// Default off until W1 validation gate completes.
export const FEATURE_THEME_BUNDLE = process.env.FEATURE_THEME_BUNDLE === '1';
export const ACTIVE_THEME = process.env.ACTIVE_THEME || 'ai-builder';

// Phase 2 of pipeline redesign — output split.
// When 1, the synthesizer writes only data/staging/editorial.json (lead /
// signals / ideation + memory); a mechanical merge step composes the
// final data/reports/<date>.json from editorial + curated/*.json. This
// eliminates the 32K output-token cap risk by moving the bulk of report
// content (curated items) out of the LLM's responsibility.
export const FEATURE_MERGE_STEP = process.env.FEATURE_MERGE_STEP === '1';
