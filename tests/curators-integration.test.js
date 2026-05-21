import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validate as validateShipped } from '../src/curators/shipped.js';

describe('Curator validate end-to-end', () => {
  it('shipped curator validates known-good fixture', async () => {
    const fixture = JSON.parse(
      await readFile('tests/fixtures/curated/shipped-expected-shape.json', 'utf8'),
    );
    const parsed = validateShipped(fixture);
    expect(parsed.trending[0].id).toBe('shipped.trending.0:vllm-project/vllm');
    expect(parsed.trending[0].audience).toBe('both');
  });

  it('shipped curator rejects bad shape', () => {
    expect(() => validateShipped({ trending: 'not-an-array' })).toThrow(/trending/);
  });

  it('shipped curator rejects missing required name', () => {
    expect(() =>
      validateShipped({
        trending: [{ id: 'x' }],
        topic_discovery: [],
        dev_watch_taiwan: [],
        dev_watch_global: [],
      }),
    ).toThrow();
  });
});
