import { describe, expect, it } from 'vitest';
import { parseArxivEntry } from '../src/fetchers/arxiv.js';

describe('parseArxivEntry', () => {
  it('extracts paper id, title, abstract, authors, categories', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2604.12345v1',
      title: 'A New Approach to KV Cache Offloading',
      summary: 'We propose a method...',
      published: '2026-05-15T00:00:00Z',
      authors: [{ name: 'Alice Researcher' }, { name: 'Bob Scientist' }],
      categories: 'cs.LG cs.CL',
    };
    const norm = parseArxivEntry(entry);
    expect(norm.paper_id).toBe('2604.12345');
    expect(norm.title).toBe('A New Approach to KV Cache Offloading');
    expect(norm.authors).toEqual(['Alice Researcher', 'Bob Scientist']);
    expect(norm.categories).toContain('cs.LG');
  });

  it('handles dc:creator format (Atom RSS variant)', () => {
    const entry = {
      id: 'http://arxiv.org/abs/2604.99999v1',
      title: 'Test',
      'dc:creator': 'Charlie, Dana',
      summary: '',
    };
    const norm = parseArxivEntry(entry);
    expect(norm.authors).toEqual(['Charlie', 'Dana']);
  });
});
