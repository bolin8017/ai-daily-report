#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SECTIONS = ['shipped', 'pulse', 'market', 'tech'];
const DEFAULT_MAX_ITEMS_PER_SECTION = 8;
const DEFAULT_MAX_TRACKING_ITEMS = 6;
const DEFAULT_MAX_PREDICTIONS = 6;
const DEFAULT_MAX_CHARS = 60_000;

async function readText(file, fallback = '') {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function readJson(file, fallback = null) {
  const text = await readText(file, null);
  if (text === null) return fallback;
  return JSON.parse(text);
}

function flattenCuratedSection(sectionId, doc) {
  const items = [];
  if (!doc || typeof doc !== 'object') return items;
  for (const [group, groupItems] of Object.entries(doc)) {
    if (!Array.isArray(groupItems)) continue;
    for (const item of groupItems) {
      if (!item || typeof item !== 'object') continue;
      items.push({ section: sectionId, group, item });
    }
  }
  return items;
}

function itemTitle(item) {
  return (
    item.name ?? item.title ?? item.repo ?? item.model ?? item.company ?? item.id ?? 'untitled'
  );
}

function itemText(item) {
  const parts = [
    item.id,
    item.name,
    item.title,
    item.takeaway,
    item.desc,
    item.description,
    item.summary,
    item.source,
  ];
  return parts.filter(Boolean).join(' ');
}

function oneLine(value, max = 220) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function curatedSnapshot(
  curatedItems,
  sourceAges,
  maxItemsPerSection = DEFAULT_MAX_ITEMS_PER_SECTION,
) {
  const bySection = new Map();
  for (const entry of curatedItems) {
    if (!bySection.has(entry.section)) bySection.set(entry.section, []);
    bySection.get(entry.section).push(entry);
  }

  const lines = ['## Curated evidence snapshot', ''];
  for (const section of DEFAULT_SECTIONS) {
    const entries = (bySection.get(section) ?? []).slice(0, maxItemsPerSection);
    lines.push(`### ${section}`);
    if (entries.length === 0) {
      lines.push('- none selected');
      lines.push('');
      continue;
    }
    for (const { group, item } of entries) {
      const id = item.id ?? `${section}.${group}`;
      const age = sourceAges?.[id];
      const ageText = Number.isFinite(age) ? `; age_days=${age}` : '';
      const title = oneLine(itemTitle(item), 120);
      const takeaway = oneLine(
        item.takeaway ?? item.desc ?? item.description ?? item.summary ?? '',
        260,
      );
      lines.push(`- \`${id}\` (${group}${ageText}) — ${title}${takeaway ? `: ${takeaway}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function splitMarkdownBlocks(markdown) {
  const blocks = [];
  const re = /^##\s+(.+)$/gm;
  const matches = [...markdown.matchAll(re)];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : markdown.length;
    blocks.push({ title: matches[i][1].trim(), body: markdown.slice(start, end).trim() });
  }
  return blocks;
}

function keywordsFromBlock(block) {
  return new Set(
    `${block.title}\n${block.body}`
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .filter((token) => token.length >= 4),
  );
}

function scoreBlockAgainstEvidence(block, evidenceText) {
  const keywords = keywordsFromBlock(block);
  const haystack = evidenceText.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (haystack.includes(keyword)) score += 1;
  }
  return score;
}

async function selectedMarkdownBlocks({ file, evidenceText, limit, emptyLabel }) {
  const markdown = await readText(file, '');
  const blocks = splitMarkdownBlocks(markdown);
  if (blocks.length === 0) return [`- ${emptyLabel}`];

  const scored = blocks
    .map((block, idx) => ({ ...block, idx, score: scoreBlockAgainstEvidence(block, evidenceText) }))
    .filter((block) => block.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit);

  const selected = scored.length > 0 ? scored : blocks.slice(0, Math.min(1, limit));
  return selected.map((block) => block.body);
}

async function resolveDate(date, stagingDir) {
  if (date) return date;
  const metadata = await readJson(path.join(stagingDir, 'metadata.json'), {});
  if (metadata.date) return metadata.date;
  throw new Error('date is required (pass --date or provide data/staging/metadata.json)');
}

export async function loadCurated({ stagingDir, sections = DEFAULT_SECTIONS }) {
  const curatedDir = path.join(stagingDir, 'curated');
  const docs = {};
  const items = [];
  for (const section of sections) {
    const doc = await readJson(path.join(curatedDir, `${section}.json`), {});
    docs[section] = doc;
    items.push(...flattenCuratedSection(section, doc));
  }
  return { docs, items };
}

export async function buildReportContext({
  date,
  stagingDir = 'data/staging',
  wikiRoot = process.env.AI_DAILY_REPORT_WIKI_ROOT ??
    '/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report',
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  date = await resolveDate(date, stagingDir);

  const { items } = await loadCurated({ stagingDir });
  const sourceAges = await readJson(path.join(stagingDir, 'source-ages.json'), {});
  const evidenceText = items.map(({ item }) => itemText(item)).join('\n');

  const trackingBlocks = await selectedMarkdownBlocks({
    file: path.join(wikiRoot, 'tracking', 'active.md'),
    evidenceText,
    limit: DEFAULT_MAX_TRACKING_ITEMS,
    emptyLabel: 'none selected',
  });
  const predictionBlocks = await selectedMarkdownBlocks({
    file: path.join(wikiRoot, 'predictions', 'open.md'),
    evidenceText,
    limit: DEFAULT_MAX_PREDICTIONS,
    emptyLabel: 'none selected',
  });

  const parts = [
    `# Report Context for ${date}`,
    '',
    '## Selection policy',
    "This file is bounded context assembled from Hermes Wiki plus today's curated evidence. It is not the full memory store. The synthesizer must not read the whole Wiki.",
    '',
    curatedSnapshot(items, sourceAges),
    '## Selected tracking items',
    '',
    ...trackingBlocks,
    '',
    '## Open predictions due or relevant today',
    '',
    ...predictionBlocks,
    '',
    '## Do-not-repeat warnings',
    '- Do not frame arXiv shared `published` timestamps as same-day research bursts.',
    '- Do not claim named sources confirmed production status unless their takeaway states it.',
    '- Do not echo the full tracking or prediction ledger into the public report.',
    '',
  ];

  const markdown = parts.join('\n');
  if (markdown.length <= maxChars) return markdown;
  return `${markdown.slice(0, maxChars)}\n\n<!-- truncated by build-report-context maxChars=${maxChars} -->\n`;
}

export async function writeReportContext({
  date,
  stagingDir = 'data/staging',
  wikiRoot = process.env.AI_DAILY_REPORT_WIKI_ROOT ??
    '/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report',
} = {}) {
  date = await resolveDate(date, stagingDir);
  const markdown = await buildReportContext({ date, stagingDir, wikiRoot });
  const outputPath = path.join(stagingDir, 'report-context.md');
  const archivePath = path.join(wikiRoot, 'report-context', `${date}.md`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(archivePath), { recursive: true });
  await writeFile(outputPath, markdown, 'utf8');
  await writeFile(archivePath, markdown, 'utf8');
  return { outputPath, archivePath, bytes: Buffer.byteLength(markdown, 'utf8') };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') opts.date = argv[++i];
    else if (arg === '--staging-dir') opts.stagingDir = argv[++i];
    else if (arg === '--wiki-root') opts.wikiRoot = argv[++i];
    else if (arg === '--stdout') opts.stdout = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function usage() {
  return `Usage: node scripts/hermes/build-report-context.mjs [--date YYYY-MM-DD] [--staging-dir data/staging] [--wiki-root PATH] [--stdout]\n`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    return;
  }
  if (opts.stdout) {
    process.stdout.write(await buildReportContext(opts));
    return;
  }
  const result = await writeReportContext(opts);
  console.error(`[build-report-context] wrote ${result.outputPath} (${result.bytes} bytes)`);
  console.error(`[build-report-context] archived ${result.archivePath}`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  main().catch((error) => {
    console.error(`[build-report-context] FATAL: ${error.message}`);
    process.exit(1);
  });
}
