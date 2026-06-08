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

Today is ${date}. First use the Read tool on every input listed above, plus the bounded report context:
- \`${reportContextFile}\` — local-only Hermes Wiki context selected for today's evidence. This is your ONLY cross-day context; do not read the full Wiki, and do not read or write any legacy memory file.

<output_contract>
Produce exactly ONE artifact: the editorial layer, written with the Write tool to
\`${editorialFile}\`. Nothing else you say is an output.

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
Do NOT put \`shipped\`, \`pulse\`, \`market\`, or \`tech\` in this file — a later mechanical step
merges those from \`data/staging/curated/*.json\`. Re-emitting them is what blew the 32K
output-token cap on 2026-05-24.
</exclude>

<source_links>
Every id in a \`source_links\` array must be COPIED VERBATIM from a curated file you read this
run — \`data/staging/curated/{shipped,pulse,market,tech}.json\`. The format is
\`<section>.<subgroup>.<index>:<slug>\`, e.g. \`shipped.trending.0:vllm-project/vllm\`.
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

Begin now: Read the inputs, then make exactly ONE Write call to \`${editorialFile}\`. Do not
print the JSON to stdout, and do not output prose, acknowledgement, or explanation — the
written file is your entire response.
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
