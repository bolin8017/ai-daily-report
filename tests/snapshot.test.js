// Review finding collect-5: the feeds snapshot is committed by Stage 4, so a
// zero-item feed day must not overwrite the previously committed snapshot —
// that publishes empty footer source pills / feed lists until the next run.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/lib/snapshot.js';

describe('buildSnapshot', () => {
  let dir;
  let dst;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'snapshot-'));
    dst = join(dir, 'feeds-snapshot.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('skips the write on a zero-item day, keeping the previous snapshot', () => {
    writeFileSync(dst, '{"prev":true}\n');
    const out = buildSnapshot({ ok: false, items: [] }, dst);
    expect(out).toBeNull();
    expect(readFileSync(dst, 'utf8')).toBe('{"prev":true}\n');
  });

  it('writes a grouped snapshot for a non-empty day', () => {
    const out = buildSnapshot(
      { ok: true, items: [{ source: 'simonwillison', title: 't', url: 'https://x' }] },
      dst,
    );
    expect(out.total_items).toBe(1);
    const onDisk = JSON.parse(readFileSync(dst, 'utf8'));
    expect(onDisk.by_source.simonwillison).toHaveLength(1);
  });
});
