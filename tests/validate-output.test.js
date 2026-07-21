// Regression tests for the ops-1 finding (2026-07-21 operational reliability
// review): a curator writing malformed JSON (unescaped inner quotes,
// truncation) must be repairable deterministically instead of aborting the
// day. The 2026-07-08 → 07-12 production streak failed with
// "Expected ',' or '}' after property value" every day, twice a day.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWithRepair, validateOutputFile } from '../src/curators/validate-output.js';

const VALID_PULSE = {
  hn: [{ id: 'pulse.hn.0:hn-1', title: 'a story' }],
  lobsters: [],
  chinese_community: [],
  ai_bloggers: [],
};

function tmpFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'validate-output-'));
  const file = join(dir, 'pulse.json');
  writeFileSync(file, content);
  return file;
}

describe('parseWithRepair', () => {
  it('passes valid JSON through unrepaired', () => {
    const { data, repaired } = parseWithRepair(JSON.stringify(VALID_PULSE));
    expect(repaired).toBe(false);
    expect(data.hn[0].title).toBe('a story');
  });

  it('repairs an unescaped inner quote (the production failure class)', () => {
    const malformed =
      '{"hn": [{"id": "pulse.hn.0:hn-1", "title": "he said "no way" and left"}], "lobsters": [], "chinese_community": [], "ai_bloggers": []}';
    const { data, repaired } = parseWithRepair(malformed);
    expect(repaired).toBe(true);
    expect(data.hn[0].title).toContain('no way');
  });

  it('repairs truncated JSON', () => {
    const truncated = '{"hn": [{"id": "pulse.hn.0:hn-1", "title": "a story"';
    const { data, repaired } = parseWithRepair(truncated);
    expect(repaired).toBe(true);
    expect(data.hn[0].title).toBe('a story');
  });

  it('rethrows the original parse error when repair is impossible', () => {
    expect(() => parseWithRepair('')).toThrow(SyntaxError);
  });
});

describe('validateOutputFile', () => {
  it('validates, normalizes, and reports items for a valid file', async () => {
    const file = tmpFile(JSON.stringify(VALID_PULSE));
    const result = await validateOutputFile('pulse', file);
    expect(result).toEqual({ items: 1, repaired: false });
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.hn[0].audience).toBe('general'); // schema default applied
  });

  it('repairs a malformed file in place before validating', async () => {
    const file = tmpFile(
      '{"hn": [{"id": "pulse.hn.0:hn-1", "title": "he said "hi" ok"}], "lobsters": [], "chinese_community": [], "ai_bloggers": []}',
    );
    const result = await validateOutputFile('pulse', file);
    expect(result.repaired).toBe(true);
    expect(() => JSON.parse(readFileSync(file, 'utf8'))).not.toThrow();
  });

  it('throws a schema error for shape-invalid output', async () => {
    const file = tmpFile(JSON.stringify({ hn: [] })); // missing required groups
    await expect(validateOutputFile('pulse', file)).rejects.toThrow(
      /Curated output validation failed/,
    );
  });

  it('rejects unknown sections', async () => {
    const file = tmpFile('{}');
    await expect(validateOutputFile('nope', file)).rejects.toThrow(/unknown section/);
  });
});

describe('CLI', () => {
  const cli = join(process.cwd(), 'src/curators/validate-output.js');

  it('exits 0 and logs items on valid input', () => {
    const file = tmpFile(JSON.stringify(VALID_PULSE));
    const out = execFileSync(process.execPath, [cli, 'pulse', file], { encoding: 'utf8' });
    expect(out).toContain('validated, items=1');
  });

  it('exits 2 on unrepairable-invalid input', () => {
    const file = tmpFile(JSON.stringify({ hn: [] }));
    expect(() =>
      execFileSync(process.execPath, [cli, 'pulse', file], { encoding: 'utf8', stdio: 'pipe' }),
    ).toThrow(/status 2|command failed/i);
  });
});
