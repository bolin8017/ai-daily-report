// Shared helpers for Stage 2 curators.
// Stable id generation, prompt assembly (_shared.md + per-section), output
// validation against curated sub-schemas.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACTIVE_THEME } from '../lib/config.js';
import { loadSection } from '../lib/theme.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
 * Read and concatenate the shared voice rules + a per-section curator
 * prompt from the active theme bundle.
 *
 * @param {string} section 'discoveries' | 'pulse' | 'market' | 'tech'
 * @returns {Promise<string>}
 */
export async function mergePrompts(section) {
  const sec = await loadSection(ACTIVE_THEME, section);
  const sectionPath = sec.paths.curator_prompt;
  const sharedPath = join(dirname(sectionPath), '..', '_shared.md');
  const shared = await readFile(sharedPath, 'utf8');
  const sectionPrompt = await readFile(sectionPath, 'utf8');
  return `${shared}\n\n---\n\n${sectionPrompt}`;
}

/**
 * Render one staging input for inlining into a single-turn prompt (curators
 * and the synthesizer). JSON is
 * re-serialized compactly (the staging files are pretty-printed, and the
 * indentation is pure token cost to the model); `transform` may drop fields
 * the section prompt never uses. A missing file is reported inline instead of
 * throwing, mirroring what a failed Read used to tell the model.
 *
 * @param {string} stagingDir
 * @param {string} name file name relative to the staging dir
 * @param {(data: unknown) => unknown} [transform]
 * @param {string} [label] path shown to the model (the one the prompt names)
 * @returns {Promise<string>}
 */
export async function renderInput(stagingDir, name, transform, label = `data/staging/${name}`) {
  let text;
  try {
    text = await readFile(join(stagingDir, name), 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return `<file path="${label}" missing="true"></file>`;
    throw err;
  }
  let body = text.trim();
  if (name.endsWith('.json')) {
    try {
      const data = JSON.parse(text);
      body = JSON.stringify(transform ? transform(data) : data);
    } catch {
      // Not parseable — hand the model the raw text, as a Read would have.
    }
  }
  return `<file path="${label}">\n${body}\n</file>`;
}

/**
 * Build the complete single-turn curator prompt: the shared + section rules,
 * every staging input the section manifest declares inlined verbatim, and the
 * execute instruction. The call runs with no tools and the reply text is the
 * curated JSON — the tool loop (Read in chunks, then Write) re-sent the whole
 * accumulated context on every turn.
 *
 * @param {string} section
 * @param {object} [opts]
 * @param {string} [opts.stagingDir] where the inputs are read from
 * @param {Record<string, (data: unknown) => unknown>} [opts.transforms] per-file transform
 * @returns {Promise<string>}
 */
export async function buildCuratorPrompt(section, opts = {}) {
  const { stagingDir = 'data/staging', transforms = {} } = opts;
  const sec = await loadSection(ACTIVE_THEME, section);
  const names = [...(sec.inputs.required ?? []), ...(sec.inputs.optional ?? [])];
  const files = await Promise.all(names.map((n) => renderInput(stagingDir, n, transforms[n])));
  const rules = await mergePrompts(section);
  return `${rules}

---

## Inputs

The staging files named above are inlined below, one \`<file>\` block each (JSON re-serialized
compactly; the content is complete). They are your entire input — this session has no tools, so
do not try to read or write files.

${files.join('\n\n')}

---

## Execute now

Apply the include/exclude rules per sub-group to the inputs above and reply with the strict JSON
object matching the schema. Your reply is saved verbatim as \`data/staging/curated/${section}.json\`,
so it must be that one JSON object and nothing else: no prose, no acknowledgement, no explanation,
no markdown fences. Do not ask questions.
`;
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
