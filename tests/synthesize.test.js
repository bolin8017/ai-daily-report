// Tests for src/lib/synthesize.js — focused on the deterministic parts
// (extractJson + prompt formation). The claude -p subprocess call itself is
// not tested here; that's exercised by the real pipeline run on the VM.

import { describe, expect, it } from 'vitest';
import { _internals, extractJson } from '../src/lib/synthesize.js';

describe('extractJson', () => {
  it('parses plain JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses plain JSON array', () => {
    expect(extractJson('[1, 2, 3]')).toEqual([1, 2, 3]);
  });

  it('strips ```json fences', () => {
    const input = '```json\n{"foo": "bar"}\n```';
    expect(extractJson(input)).toEqual({ foo: 'bar' });
  });

  it('strips bare ``` fences', () => {
    const input = '```\n[1, 2]\n```';
    expect(extractJson(input)).toEqual([1, 2]);
  });

  it('extracts first JSON object when preceded by prose', () => {
    const input = 'Here is your report:\n\n{"date": "2026-04-11", "items": []}\n\nHope this helps!';
    expect(extractJson(input)).toEqual({ date: '2026-04-11', items: [] });
  });

  it('handles nested objects in brace walk', () => {
    const input = 'preamble {"outer": {"inner": [1, {"deep": "value"}]}} trailing';
    expect(extractJson(input)).toEqual({ outer: { inner: [1, { deep: 'value' }] } });
  });

  it('respects string quoting when matching braces', () => {
    // A closing brace inside a string literal should not end the walk early
    const input = '{"text": "}} fake close", "real": true}';
    expect(extractJson(input)).toEqual({ text: '}} fake close', real: true });
  });

  it('throws when no JSON is present', () => {
    expect(() => extractJson('just some prose')).toThrow(/no JSON/);
  });
});

describe('buildReportPrompt', () => {
  const mockCondensed = {
    unified: { ok: true, items: [{ title: 'HN item', source: 'hackernews' }] },
    trending: { ok: true, items: [{ full_name: 'foo/bar' }] },
    search: { ok: true, items: [] },
    developers: { ok: true, items: [] },
  };
  const mockMemory = {
    schema_version: 2,
    last_updated: '2026-04-10',
    short_term: { featured_repos: [] },
    long_term: { featured_repos: [] },
  };

  it('includes the daily-report.md agent prompt', () => {
    const prompt = _internals.buildReportPrompt({
      date: '2026-04-11',
      condensed: mockCondensed,
      memory: mockMemory,
    });
    // The agent prompt starts with this header
    expect(prompt).toContain('AI Daily Report Agent');
  });

  it('includes the quality rules file', () => {
    const prompt = _internals.buildReportPrompt({
      date: '2026-04-11',
      condensed: mockCondensed,
      memory: mockMemory,
    });
    expect(prompt).toContain('Quality rules');
  });

  it('embeds the date', () => {
    const prompt = _internals.buildReportPrompt({
      date: '2026-04-11',
      condensed: mockCondensed,
      memory: mockMemory,
    });
    expect(prompt).toContain("Today's date: 2026-04-11");
  });

  it('embeds the condensed data as JSON', () => {
    const prompt = _internals.buildReportPrompt({
      date: '2026-04-11',
      condensed: mockCondensed,
      memory: mockMemory,
    });
    expect(prompt).toContain('hackernews');
    expect(prompt).toContain('foo/bar');
  });

  it('projects memory context (not the full memory blob)', () => {
    const prompt = _internals.buildReportPrompt({
      date: '2026-04-11',
      condensed: mockCondensed,
      memory: {
        ...mockMemory,
        topics: [{ name: 'should_not_appear_in_prompt', hit_count: 5 }],
      },
    });
    // topics/narrative_arcs are intentionally dropped from the digest
    expect(prompt).not.toContain('should_not_appear_in_prompt');
  });

  it('ends with the strict JSON-only instruction', () => {
    const prompt = _internals.buildReportPrompt({
      date: '2026-04-11',
      condensed: mockCondensed,
      memory: mockMemory,
    });
    expect(prompt).toContain('Output ONLY the JSON');
  });
});

describe('buildMemoryPrompt', () => {
  const mockReport = { date: '2026-04-11', lead: { html: '<h3>test</h3>' } };
  const mockMemory = { schema_version: 2, last_updated: '2026-04-10' };

  it('lists the memory update rules', () => {
    const prompt = _internals.buildMemoryPrompt({
      date: '2026-04-11',
      report: mockReport,
      memory: mockMemory,
    });
    expect(prompt).toContain('short_term.featured_repos');
    expect(prompt).toContain('times_featured >= 3');
    expect(prompt).toContain('narrative_arcs');
  });

  it('embeds both report and memory as JSON', () => {
    const prompt = _internals.buildMemoryPrompt({
      date: '2026-04-11',
      report: mockReport,
      memory: mockMemory,
    });
    expect(prompt).toContain(JSON.stringify(mockMemory, null, 2));
    expect(prompt).toContain(JSON.stringify(mockReport, null, 2));
  });

  it('ends with the strict JSON-only instruction', () => {
    const prompt = _internals.buildMemoryPrompt({
      date: '2026-04-11',
      report: mockReport,
      memory: mockMemory,
    });
    expect(prompt).toContain('Output ONLY the JSON');
  });
});
