import { describe, expect, it } from 'vitest';
import { buildArxivSearchQuery } from '../src/fetchers/providers/arxiv-rss.js';

describe('buildArxivSearchQuery', () => {
  it('ORs quoted keywords across abstract and ANDs the cs.* categories', () => {
    const q = buildArxivSearchQuery(['kv cache', 'retrieval']);
    expect(q).toContain('abs:%22kv+cache%22');
    expect(q).toContain('abs:retrieval');
    expect(q).toContain('+OR+');
    expect(q).toContain('+AND+');
    expect(q).toMatch(/cat:cs\.(AI|CL|LG|IR)/);
  });
  it('caps the number of keywords to keep the query bounded', () => {
    const many = Array.from({ length: 80 }, (_, i) => `kw${i}`);
    const q = buildArxivSearchQuery(many, { maxKeywords: 40 });
    expect((q.match(/abs:/g) || []).length).toBe(40);
  });
  it('returns null for an empty keyword list', () => {
    expect(buildArxivSearchQuery([])).toBeNull();
  });
});
