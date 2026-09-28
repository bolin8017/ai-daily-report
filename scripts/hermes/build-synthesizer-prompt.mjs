#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderInput } from '../../src/curators/_base.js';

// Inputs inlined into the prompt, so the common path is a single turn. The
// Read-tool loop took ~20 turns, each re-sending the whole accumulated
// context (~1.1M cache-read tokens a day). Inlined: every curated file, the
// small raw inputs, the bounded context, source ages for the curated urls, and
// the editorial schema source the model otherwise went looking for. The large
// raw feeds (feeds-*.json) and the full source-ages.json stay on disk for the
// targeted Read / Grep lookups the prompt allows ("when curated isn't enough").
const CURATED_INPUTS = ['discoveries.json', 'pulse.json', 'market.json', 'tech.json'];
const STAGING_INPUTS = [
  'report-context.md',
  'metadata.json',
  'leaderboards.json',
  'mops.json',
  'hf_trending.json',
  'arxiv.json',
];
const SCHEMA_SOURCES = ['src/schemas/editorial.js', 'src/schemas/items.js'];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function collectUrls(value, out) {
  if (Array.isArray(value)) {
    for (const v of value) collectUrls(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'url' && typeof v === 'string') out.add(v);
      else collectUrls(v, out);
    }
  }
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function renderInputs(stagingDir, curatedDir) {
  const curatedDocs = await Promise.all(
    CURATED_INPUTS.map((n) => readJson(path.join(curatedDir, n))),
  );
  const urls = collectUrls(curatedDocs, new Set());
  const onlyCuratedUrls = (ages) =>
    Object.fromEntries(Object.entries(ages ?? {}).filter(([url]) => urls.has(url)));
  const blocks = await Promise.all([
    ...CURATED_INPUTS.map((n) =>
      renderInput(curatedDir, n, undefined, `data/staging/curated/${n}`),
    ),
    ...STAGING_INPUTS.map((n) => renderInput(stagingDir, n)),
    renderInput(
      stagingDir,
      'source-ages.json',
      onlyCuratedUrls,
      'data/staging/source-ages.json (entries for the curated urls; the full file is on disk)',
    ),
    ...SCHEMA_SOURCES.map((f) => renderInput(REPO_ROOT, f, undefined, f)),
  ]);
  return blocks.join('\n\n');
}

async function readText(file, fallback = '') {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function stripLegacyMemoryDirectives(text) {
  return text
    .split('\n')
    .filter((line) => !/data\/memory\.json|memory updates?|updated memory/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function buildSynthesizerPrompt({
  date,
  activeTheme = 'ai-builder',
  editorialFile = 'data/staging/editorial.json',
  reportContextFile = 'data/staging/report-context.md',
  synthPromptPath = `themes/${activeTheme}/synthesizer.md`,
  qualityPath = `themes/${activeTheme}/quality.md`,
  stagingDir = 'data/staging',
  curatedDir = path.join(stagingDir, 'curated'),
} = {}) {
  if (!date) throw new Error('date is required');
  const inputs = await renderInputs(stagingDir, curatedDir);
  const basePrompt = stripLegacyMemoryDirectives(await readText(synthPromptPath));
  const quality = stripLegacyMemoryDirectives(await readText(qualityPath, ''));

  // Long inputs first, instructions after: Anthropic's long-context guidance
  // (documents at the top, the task at the end) — the instructions stay the
  // last thing the model reads before answering.
  const parts = [
    `<inputs>\n${inputs}\n</inputs>\n\n---\n`,
    basePrompt,
    quality ? '\n---\n\n' : '',
    quality ? quality.trim() : '',
    `
---

## Execute now

Today is ${date}. The \`<inputs>\` block at the top of this prompt inlines, one \`<file>\` per path
(JSON re-serialized compactly; each file complete): all four curated files, the bounded report
context, metadata, leaderboards, mops, hf_trending, arxiv, the source ages of every curated url,
and the EditorialSchema source (\`src/schemas/editorial.js\` + \`items.js\`) your output must
pass. Start from these — they are usually all you need. The raw per-section feeds
(\`data/staging/feeds-{pulse,market,tech,shipped}.json\`) and the full
\`data/staging/source-ages.json\` are not inlined; when curated isn't enough, look up the
specific items you need with Grep / a ranged Read rather than reading whole files. Do not read
anything else.
- \`${reportContextFile}\` — local-only Hermes Wiki context selected for today's evidence. This is your ONLY cross-day context; there is no full Wiki and no legacy memory file.

<output_contract>
Produce exactly ONE artifact: the editorial layer. Your reply is saved verbatim as
\`${editorialFile}\`, so your reply is that one JSON object and nothing else.

<shape>
{
  "schema_version": "2.1-editorial",        // exact string literal
  "date": "${date}",
  "theme": "${activeTheme}",
  "lead": { "html": "..." },
  "signals": {
    "focus": [ /* SignalItem */ ],
    "sleeper": { /* SignalItem */ },         // optional
    "contrarian": { /* SignalItem */ },      // optional
    "predictions": [ /* PredictionItem */ ],
    "prediction_updates": [ /* PredictionItem */ ]  // optional
  }
}
</shape>
Keys marked optional (\`sleeper\`, \`contrarian\`, \`prediction_updates\`) appear only when the
day's evidence genuinely supports them — never an empty placeholder to fill a slot. \`status\`
is one of the four allowed enum values. See the per-section specs above.

<exclude>
Do NOT put \`discoveries\`, \`pulse\`, \`market\`, or \`tech\` in this file — a later mechanical step
merges those from \`data/staging/curated/*.json\`. Re-emitting them is what blew the 32K
output-token cap on 2026-05-24.
</exclude>

<source_links>
Every id in a \`source_links\` array must be COPIED VERBATIM from a curated file inlined above — \`data/staging/curated/{discoveries,pulse,market,tech}.json\`. The format is
\`<section>.<subgroup>.<index>:<slug>\`, e.g. \`discoveries.rising.0:vllm-project/vllm\`.
- Never reconstruct, renumber, abbreviate, or guess an id. If you did not read it from a
  file this run, you do not have it.
- No grounded curated source for a claim? Use \`[]\`. An empty array is always valid; an
  invented id never is — it becomes a dead cross-tab link the reader clicks into nowhere.
- This is abstention, not laziness: fewer-but-real citations beat more-but-fabricated. The
  merge step silently drops any id it cannot resolve, so a wrong id will not crash the run —
  it just costs the reader that link, with no warning. The discipline is on you.
</source_links>

<no_memory>
Do not write or update any legacy memory file. Cross-day state lives in Hermes Wiki, already
distilled into the report context above.
</no_memory>
</output_contract>

Begin now: reply with the editorial JSON object only — it is written to \`${editorialFile}\`. No
markdown fences, no prose, no acknowledgement, no explanation: the reply is the file.
`,
  ];

  return `${parts.filter(Boolean).join('\n').trimEnd()}\n`;
}

export async function writeSynthesizerPrompt(options = {}) {
  const { outputPath } = options;
  if (!outputPath) throw new Error('outputPath is required');
  const prompt = await buildSynthesizerPrompt(options);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, prompt, 'utf8');
  return { outputPath, bytes: Buffer.byteLength(prompt, 'utf8') };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') opts.date = argv[++i];
    else if (arg === '--theme') opts.activeTheme = argv[++i];
    else if (arg === '--editorial-file') opts.editorialFile = argv[++i];
    else if (arg === '--report-context-file') opts.reportContextFile = argv[++i];
    else if (arg === '--synth-prompt') opts.synthPromptPath = argv[++i];
    else if (arg === '--quality') opts.qualityPath = argv[++i];
    else if (arg === '--output') opts.outputPath = argv[++i];
    else if (arg === '--staging-dir') opts.stagingDir = argv[++i];
    else if (arg === '--curated-dir') opts.curatedDir = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function usage() {
  return `Usage: node scripts/hermes/build-synthesizer-prompt.mjs --date YYYY-MM-DD --output PATH [--theme ai-builder] [--editorial-file PATH] [--report-context-file PATH]\n`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await writeSynthesizerPrompt(opts);
  console.error(`[build-synthesizer-prompt] wrote ${result.outputPath} (${result.bytes} bytes)`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  main().catch((error) => {
    console.error(`[build-synthesizer-prompt] FATAL: ${error.message}`);
    process.exit(1);
  });
}
