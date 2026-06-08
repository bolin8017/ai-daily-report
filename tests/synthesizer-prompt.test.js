import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
    expect(prompt).toContain('bounded report context');
    // Output contract: exactly one Write call, written file is the sole output.
    expect(prompt).toContain('exactly ONE Write call');
    expect(prompt).toContain('written file is your entire response');
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
});
