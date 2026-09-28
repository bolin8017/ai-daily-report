import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildSynthesizerPrompt,
  writeSynthesizerPrompt,
} from '../scripts/hermes/build-synthesizer-prompt.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adr-synth-prompt-'));
  const synthPromptPath = path.join(root, 'synthesizer.md');
  const qualityPath = path.join(root, 'quality.md');
  const outputPath = path.join(root, 'synthesizer.prompt.txt');
  await writeFile(
    synthPromptPath,
    '# Synth\n\nBase synthesizer prompt.\n\nMemory:\n- `data/memory.json` — legacy state.\n\nWrite updated memory to `data/memory.json`.\n',
    'utf8',
  );
  await writeFile(qualityPath, '# Quality\n\nDelete slop.\n', 'utf8');
  return { synthPromptPath, qualityPath, outputPath };
}

describe('build-synthesizer-prompt', () => {
  it('adds report-context as required bounded memory and removes legacy memory.json directives', async () => {
    const { synthPromptPath, qualityPath } = await fixture();

    const prompt = await buildSynthesizerPrompt({
      date: '2026-06-03',
      activeTheme: 'ai-builder',
      editorialFile: 'data/staging/editorial.json',
      reportContextFile: 'data/staging/report-context.md',
      synthPromptPath,
      qualityPath,
    });

    expect(prompt).toContain('data/staging/report-context.md');
    expect(prompt).toContain('bounded report');
    // Output contract: the reply is the editorial file, nothing else.
    expect(prompt).toContain('Your reply is saved verbatim as');
    expect(prompt).toContain('the reply is the file');
    expect(prompt).toContain('"2.1-editorial"');
    // Path Y source_links discipline: cite-or-empty, never invent.
    expect(prompt).toContain('An empty array is always valid');
    expect(prompt).not.toContain('abort the pipeline');
    expect(prompt).not.toContain('data/memory.json');
    expect(prompt).not.toContain('Write updated memory');
    expect(prompt).not.toContain('updated memory');
  });

  it('real ai-builder prompt has no legacy memory or merged-section output contract', async () => {
    const prompt = await buildSynthesizerPrompt({
      date: '2026-06-03',
      activeTheme: 'ai-builder',
      editorialFile: 'data/staging/editorial.json',
      reportContextFile: 'data/staging/report-context.md',
      synthPromptPath: 'themes/ai-builder/synthesizer.md',
      qualityPath: 'themes/ai-builder/quality.md',
    });

    expect(prompt).toContain('Cross-day state is maintained by Hermes Wiki');
    expect(prompt).not.toContain('data/memory.json');
    expect(prompt).not.toContain('"schema_version": 2');
    expect(prompt).not.toContain('shipped / pulse / market / tech sections copied verbatim');
    expect(prompt).not.toContain('"shipped": <copied verbatim');
    // Post-2026-06-15 新發現 cutover: the synthesizer cites the live `discoveries`
    // section, never the retired `shipped` (whose ids merge can no longer resolve).
    expect(prompt).toContain('discoveries.rising.0:vllm-project/vllm');
    expect(prompt).not.toContain('shipped.trending');
    expect(prompt).not.toContain('curated/shipped.json');
  });

  it('writes the assembled prompt to disk', async () => {
    const { synthPromptPath, qualityPath, outputPath } = await fixture();

    const result = await writeSynthesizerPrompt({
      date: '2026-06-03',
      activeTheme: 'ai-builder',
      editorialFile: 'data/staging/editorial.json',
      reportContextFile: 'data/staging/report-context.md',
      synthPromptPath,
      qualityPath,
      outputPath,
    });

    expect(result.outputPath).toBe(outputPath);
    await expect(readFile(outputPath, 'utf8')).resolves.toContain('data/staging/report-context.md');
  });

  it('omits ideation from the output contract (removed 2026-06)', async () => {
    const prompt = await buildSynthesizerPrompt({ date: '2026-06-09' });
    expect(prompt).not.toMatch(/ideation/i);
    expect(prompt).not.toContain('IdeaItem');
  });

  it('inlines curated files, small inputs, curated-url source ages and the schema source', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'adr-synth-inline-'));
    const curatedDir = path.join(root, 'curated');
    await mkdir(curatedDir);
    await writeFile(
      path.join(curatedDir, 'pulse.json'),
      JSON.stringify({ hn: [{ id: 'pulse.hn.0:hn-1', url: 'https://a.example/x' }] }, null, 2),
    );
    await writeFile(
      path.join(root, 'source-ages.json'),
      JSON.stringify({ 'https://a.example/x': 2, 'https://b.example/uncurated': 0 }),
    );
    await writeFile(path.join(root, 'feeds-pulse.json'), JSON.stringify({ items: ['RAW-FEED'] }));
    await writeFile(path.join(root, 'report-context.md'), '# ctx line\n');

    const prompt = await buildSynthesizerPrompt({ date: '2026-06-03', stagingDir: root });

    // Inputs come first (long-context layout), the instructions after them.
    expect(prompt.startsWith('<inputs>')).toBe(true);
    expect(prompt).toContain(
      '<file path="data/staging/curated/pulse.json">\n{"hn":[{"id":"pulse.hn.0:hn-1","url":"https://a.example/x"}]}\n</file>',
    );
    expect(prompt).toContain('<file path="data/staging/curated/tech.json" missing="true"></file>');
    expect(prompt).toContain('# ctx line');
    // Source ages are narrowed to the urls the curated files cite.
    expect(prompt).toContain('{"https://a.example/x":2}');
    expect(prompt).not.toContain('b.example/uncurated');
    // The large raw feeds stay on disk for targeted lookups.
    expect(prompt).not.toContain('RAW-FEED');
    expect(prompt).toContain('<file path="src/schemas/editorial.js">');
  });
});
