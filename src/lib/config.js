// Validated config singleton. Import this instead of reading config.json
// directly — validation runs once at module load so every consumer gets the
// same parsed + frozen object and malformed config fails loudly at startup.
//
// Source descriptors live in src/sources/registry.js (the data layer);
// per-theme source/topic config lives in themes/<theme>/sources.yaml.
// config.json now only holds cloud-fallback provider tuning + report
// rendering settings.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema } from '../schemas/config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config.json');

const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const parsed = ConfigSchema.parse(raw);

export default Object.freeze(parsed);

// Active theme directory under themes/. Resolved by src/lib/theme.js
// loaders; used throughout the pipeline for prompt / sources / sections
// path resolution.
export const ACTIVE_THEME = process.env.ACTIVE_THEME || 'ai-builder';

// Storage hot/cold tuning knobs. The data branch keeps only the last
// HOT_DAYS of reports; older reports archive monthly to GitHub Releases
// as archive-YYYY-MM tags with reports-YYYY-MM.tar.gz attached. The CI
// build step hydrates the most recent HYDRATE_MONTHS back into
// data/reports/ before 11ty builds the site.
export const HOT_DAYS = Number.parseInt(process.env.HOT_DAYS ?? '60', 10);
export const HYDRATE_MONTHS = Number.parseInt(process.env.HYDRATE_MONTHS ?? '12', 10);
