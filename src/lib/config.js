// Validated config singleton. Import this instead of reading config.json
// directly — validation runs once at module load so every fetcher gets the
// same parsed + frozen object and malformed config fails loudly at startup
// rather than as three separate cryptic errors inside each fetcher.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema } from '../schemas/config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config.json');

const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const config = ConfigSchema.parse(raw);
export default Object.freeze(config);
