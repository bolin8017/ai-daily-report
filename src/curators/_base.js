// Shared helpers for Stage 2 curators.
// Stable id generation, prompt assembly (_shared.md + per-section), output
// validation against curated sub-schemas.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVE_THEME, FEATURE_THEME_BUNDLE } from '../lib/config.js';
import { loadSection } from '../lib/theme.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LEGACY_CURATORS_DIR = join(__dirname, '..', '..', '.claude', 'curators');

/**
 * Build a deterministic stable id for an item.
 *
 * @param {object} opts
 * @param {string} opts.section
 * @param {string} opts.sub
 * @param {number} opts.index
 * @param {string} opts.type 'github' | 'hn' | 'lobsters' | 'mops' | 'rss' | 'leaderboard' | 'arxiv'
 * @returns {string}
 */
export function stableId(opts) {
  const { section, sub, index, type } = opts;
  const prefix = `${section}.${sub}.${index}`;
  let slug;
  switch (type) {
    case 'github':
      slug = `${opts.owner}/${opts.repo}`;
      break;
    case 'hn':
      slug = `hn-${opts.hn_id}`;
      break;
    case 'lobsters':
      slug = `lobsters-${opts.short_id}`;
      break;
    case 'mops':
      slug = `mops-${opts.ticker}-${opts.date}`;
      break;
    case 'rss': {
      const hash = createHash('sha256').update(opts.url).digest('hex').slice(0, 8);
      slug = `${opts.source}-${hash}`;
      break;
    }
    case 'leaderboard':
      slug = `${opts.bench}-${opts.model_id}`;
      break;
    case 'arxiv':
      slug = `arxiv-${opts.paper_id}`;
      break;
    default:
      throw new Error(`stableId: unknown type '${type}'`);
  }
  return `${prefix}:${slug}`;
}

/**
 * Read and concatenate the shared voice rules + a per-section curator prompt.
 *
 * When FEATURE_THEME_BUNDLE=1, paths resolve via theme bundle
 * (themes/$ACTIVE_THEME/sections/<id>/curator.md + sections/_shared.md).
 * Otherwise legacy .claude/curators/ paths.
 *
 * @param {string} section 'shipped' | 'pulse' | 'market' | 'tech'
 * @returns {Promise<string>}
 */
export async function mergePrompts(section) {
  let sharedPath;
  let sectionPath;
  if (FEATURE_THEME_BUNDLE) {
    const sec = await loadSection(ACTIVE_THEME, section);
    sectionPath = sec.paths.curator_prompt;
    sharedPath = join(dirname(sectionPath), '..', '_shared.md');
  } else {
    sharedPath = join(LEGACY_CURATORS_DIR, '_shared.md');
    sectionPath = join(LEGACY_CURATORS_DIR, `${section}.md`);
  }
  const shared = await readFile(sharedPath, 'utf8');
  const sectionPrompt = await readFile(sectionPath, 'utf8');
  return `${shared}\n\n---\n\n${sectionPrompt}`;
}

/**
 * Validate curator output against a section schema. Throws with descriptive
 * prefix on failure so logs identify which section drifted.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {unknown} data
 */
export function validateCuratedOutput(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Curated output validation failed:\n${issues}`);
  }
  return result.data;
}
