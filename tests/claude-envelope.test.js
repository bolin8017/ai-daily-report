import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEnvelope } from '../src/lib/claude-envelope.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/claude-envelope-sample.json'), 'utf8'),
);

describe('parseEnvelope', () => {
  it('maps a success envelope to a normalized stage-usage record', () => {
    const rec = parseEnvelope(sample, 'curate.market');
    expect(rec).toEqual({
      stage: 'curate.market',
      cost_usd: 0.0123,
      duration_ms: 18342,
      num_turns: 6,
      input_tokens: 41280,
      output_tokens: 1840,
      cache_read_tokens: 38000,
      cache_creation_tokens: 0,
      is_error: false,
      session_id: 'a1b2c3d4-0000-4000-8000-000000000000',
    });
  });

  it('returns a minimal error record for null/garbage input', () => {
    expect(parseEnvelope(null, 'synthesize')).toEqual({ stage: 'synthesize', is_error: true });
  });

  it('omits fields that are absent rather than emitting undefined', () => {
    const rec = parseEnvelope({ num_turns: 2 }, 'faithfulness');
    expect(rec).toEqual({ stage: 'faithfulness', num_turns: 2 });
  });
});
