// Parse + validate a curator's written output file, with a deterministic
// JSON-repair fallback (jsonrepair) for the malformed-JSON failure class —
// unescaped inner quotes, truncation — that Haiku curators produce on ~1/4 of
// runs and that a blind identical retry cannot fix (ops-1, 2026-07-21
// operational reliability review). Dual-mode: importable + CLI
// (`node src/curators/validate-output.js <section> <file>`), called by
// scripts/curate.sh in place of its former inline `node -e` validation.

import { realpathSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { jsonrepair } from 'jsonrepair';
import * as discoveries from './discoveries.js';
import * as market from './market.js';
import * as pulse from './pulse.js';
import * as tech from './tech.js';

const SECTIONS = { discoveries, market, pulse, tech };

/**
 * JSON.parse with a jsonrepair fallback. Rethrows the original parse error
 * (the actionable position message) when repair doesn't help.
 *
 * @param {string} text
 * @returns {{data: unknown, repaired: boolean}}
 */
export function parseWithRepair(text) {
  try {
    return { data: JSON.parse(text), repaired: false };
  } catch (parseErr) {
    try {
      return { data: JSON.parse(jsonrepair(text)), repaired: true };
    } catch {
      throw parseErr;
    }
  }
}

/**
 * Parse (repairing if needed), validate against the section's schema, and
 * write the normalized JSON back in place.
 *
 * @param {string} section 'discoveries' | 'pulse' | 'market' | 'tech'
 * @param {string} filePath
 * @returns {Promise<{items: number, repaired: boolean}>}
 */
export async function validateOutputFile(section, filePath) {
  const mod = SECTIONS[section];
  if (!mod) throw new Error(`unknown section: ${section}`);
  const raw = await readFile(filePath, 'utf8');
  const { data, repaired } = parseWithRepair(raw);
  const parsed = mod.validate(data);
  await writeFile(filePath, JSON.stringify(parsed, null, 2));
  return { items: Object.values(parsed).flat().length, repaired };
}

async function runStandalone() {
  const [section, filePath] = process.argv.slice(2);
  if (!section || !filePath) {
    console.error('usage: node src/curators/validate-output.js <section> <file>');
    process.exit(2);
  }
  try {
    const { items, repaired } = await validateOutputFile(section, filePath);
    const note = repaired ? ' (repaired malformed JSON)' : '';
    console.log(`[curate.sh] ${section} validated, items=${items}${note}`);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}

const isMain = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMain) runStandalone();
