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
