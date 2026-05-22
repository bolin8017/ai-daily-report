import { describe, expect, it } from 'vitest';
import { normalizeHFModel } from '../src/fetchers/hf-trending.js';

describe('normalizeHFModel', () => {
  it('shapes a HF model API response', () => {
    const apiItem = {
      id: 'meta-llama/Llama-4-405B-Instruct',
      downloads: 12345,
      likes: 678,
      lastModified: '2026-05-15T00:00:00.000Z',
      tags: ['text-generation', 'llama', 'pytorch'],
      pipeline_tag: 'text-generation',
    };
    const norm = normalizeHFModel(apiItem);
    expect(norm.id).toBe('meta-llama/Llama-4-405B-Instruct');
    expect(norm.url).toBe('https://huggingface.co/meta-llama/Llama-4-405B-Instruct');
    expect(norm.downloads).toBe(12345);
    expect(norm.tags).toContain('text-generation');
  });

  it('handles missing optional fields', () => {
    const norm = normalizeHFModel({ id: 'foo/bar' });
    expect(norm.id).toBe('foo/bar');
    expect(norm.downloads).toBeNull();
    expect(norm.tags).toEqual([]);
  });
});
