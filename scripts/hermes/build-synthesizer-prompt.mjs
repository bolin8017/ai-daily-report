#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
} = {}) {
  if (!date) throw new Error('date is required');
  const basePrompt = stripLegacyMemoryDirectives(await readText(synthPromptPath));
  const quality = stripLegacyMemoryDirectives(await readText(qualityPath, ''));

  const parts = [
    basePrompt,
    quality ? '\n---\n\n' : '',
    quality ? quality.trim() : '',
    `
---

## Execute now

Today is ${date}. Use the Read tool on the inputs listed above plus the bounded report context file below.

Bounded report context:
- \`${reportContextFile}\` — Hermes Wiki-derived local-only context selected for today's evidence. Use this as the only cross-day context; do not read the full Wiki and do not read or write legacy memory files.

**OUTPUT CONTRACT:**

- Write to \`${editorialFile}\` ONLY the editorial layer:
  - \`schema_version: "2.1-editorial"\` (string literal)
  - \`date: "${date}"\` (string)
  - \`theme: "${activeTheme}"\` (string)
  - \`lead: {html: "..."}\`
  - \`signals: {focus, sleeper, contrarian, predictions}\`; \`prediction_updates\` is optional and should only be used when report context gives explicit evidence for an existing prediction update.
  - \`ideation: {general, work}\`

- Do NOT include \`shipped\`, \`pulse\`, \`market\`, \`tech\` sections in editorial.json. These are merged in by a separate step that runs after this one.

- Reference items in \`source_links\` by their **stable ids** (e.g., \`shipped.trending.0:vllm-project/vllm\`) — read the ids from \`data/staging/curated/*.json\`. The merge step validates every source_link id; dangling links abort the pipeline.

- Do not write legacy memory files. Cross-day state is maintained outside the public data branch via Hermes Wiki and the bounded report context.

Final action is one Write call to \`${editorialFile}\`. Do not output prose, acknowledgement, or explanation. Begin with Read calls immediately.
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
