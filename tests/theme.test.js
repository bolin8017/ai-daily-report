// Unit tests for src/lib/theme.js — theme bundle loader.
// Run with: npx vitest run tests/theme.test.js

import { describe, expect, it } from 'vitest';
import { listActiveSections, loadSection, loadTheme } from '../src/lib/theme.js';

describe('theme loader', () => {
  it('loadTheme("ai-builder") returns the manifest with expected keys', async () => {
    const theme = await loadTheme('ai-builder');
    expect(theme.name).toBe('ai-builder');
    expect(theme.persona.audience).toMatch(/AI engineers who build/);
    expect(theme.llm.curator_model).toBe('claude-haiku-4-5');
    expect(theme.llm.synthesizer_model).toBe('claude-sonnet-4-6');
    expect(theme.sections).toHaveLength(4);
  });

  it('loadTheme resolves prompt file paths relative to theme directory', async () => {
    const theme = await loadTheme('ai-builder');
    expect(theme.prompt_paths.synthesizer).toMatch(/themes\/ai-builder\/synthesizer\.md$/);
    expect(theme.prompt_paths.lens).toMatch(/themes\/ai-builder\/lens\.md$/);
    expect(theme.prompt_paths.quality).toMatch(/themes\/ai-builder\/quality\.md$/);
  });

  it('loadTheme exposes the parsed sources.yaml as theme.sources', async () => {
    const theme = await loadTheme('ai-builder');
    expect(theme.sources.github_topics.tier.core).toContain('rag');
    expect(theme.sources.phison_overlay.enabled).toBe(true);
    expect(theme.sources.phison_overlay.sources).toHaveLength(5);
  });

  it('loadTheme exposes ui_strings.yaml as theme.ui_strings', async () => {
    const theme = await loadTheme('ai-builder');
    expect(theme.ui_strings.tabs.shipped.label).toBe('上線');
    expect(theme.ui_strings.site.title).toMatch(/AI Engineer/);
  });

  it('listActiveSections returns sections in ascending order', async () => {
    const sections = await listActiveSections('ai-builder');
    expect(sections.map((s) => s.id)).toEqual(['shipped', 'pulse', 'market', 'tech']);
  });

  it('loadSection("ai-builder", "shipped") returns manifest + resolved paths', async () => {
    const section = await loadSection('ai-builder', 'shipped');
    expect(section.id).toBe('shipped');
    expect(section.tab_label).toBe('上線');
    expect(section.critical).toBe(true);
    expect(section.audience_split).toBe(true);
    expect(section.groups).toHaveLength(4);
    expect(section.paths.curator_prompt).toMatch(
      /themes\/ai-builder\/sections\/shipped\/curator\.md$/,
    );
    expect(section.paths.schema).toMatch(/themes\/ai-builder\/sections\/shipped\/schema\.js$/);
    expect(section.paths.partial).toMatch(/themes\/ai-builder\/sections\/shipped\/partial\.njk$/);
  });

  it('loadSection throws when section id is not declared in theme', async () => {
    await expect(loadSection('ai-builder', 'nonexistent')).rejects.toThrow(/not declared in theme/);
  });

  it('loadTheme throws when theme directory does not exist', async () => {
    await expect(loadTheme('does-not-exist')).rejects.toThrow(/no such theme/);
  });
});
