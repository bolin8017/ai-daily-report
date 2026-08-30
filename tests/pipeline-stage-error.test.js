import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stageFailureReason } from '../src/pipeline/stage-error.js';

// The sequencer records one `error` per stage and the production notice prints
// it verbatim. Before this module every `failed` stage recorded null, so the
// 2026-08-26 and 08-27 outages both paged with no cause — while the cause was
// sitting in the claude envelope on disk the whole time.
const OAUTH = 'Failed to authenticate: OAuth session expired and could not be refreshed';

let dir;
let logs;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'stage-error-'));
  logs = path.join(dir, 'curated', '.logs');
  mkdirSync(logs, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(name, body, { ageMs = 0 } = {}) {
  const file = path.join(logs, name);
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  if (ageMs > 0) {
    const t = (Date.now() - ageMs) / 1000;
    utimesSync(file, t, t);
  }
}

describe('stageFailureReason', () => {
  it('reports the claude envelope result when the curator envelope is an error', () => {
    write('market.raw.json', { is_error: true, result: OAUTH });

    expect(stageFailureReason(dir, 'curate.market', { exitCode: 1 })).toBe(OAUTH);
  });

  it('falls back to the stage stderr when the envelope carries no message', () => {
    write('market.raw.json', { is_error: true, result: '' });
    write('market.err.txt', 'claude: command not found\n');

    expect(stageFailureReason(dir, 'curate.market', { exitCode: 127 })).toBe(
      'claude: command not found',
    );
  });

  it('falls back to the exit code when nothing was written to the log dir', () => {
    expect(stageFailureReason(dir, 'curate.market', { exitCode: 2 })).toBe('exit 2');
  });

  it('ignores a successful envelope and reports the exit code instead', () => {
    write('market.raw.json', { is_error: false, result: 'all good' });

    expect(stageFailureReason(dir, 'curate.market', { exitCode: 1 })).toBe('exit 1');
  });

  it('ignores artifacts left behind by an earlier run', () => {
    write('market.raw.json', { is_error: true, result: OAUTH }, { ageMs: 86_400_000 });

    expect(stageFailureReason(dir, 'curate.market', { exitCode: 1, sinceMs: Date.now() })).toBe(
      'exit 1',
    );
  });

  it('prefers the repair attempt over the first curator attempt', () => {
    write('market.raw.json', { is_error: true, result: 'first attempt died' });
    write('market.repair-raw.json', { is_error: true, result: 'repair died too' });

    expect(stageFailureReason(dir, 'curate.market', { exitCode: 1 })).toBe('repair died too');
  });

  it('reads the synthesize stage from its synthesizer-prefixed artifacts', () => {
    write('synthesizer.raw.txt', { is_error: true, result: OAUTH });

    expect(stageFailureReason(dir, 'synthesize', { exitCode: 1 })).toBe(OAUTH);
  });

  it('reads the faithfulness stage from its verdicts raw envelope', () => {
    write('faithfulness.verdicts.json.raw', { is_error: true, result: OAUTH });

    expect(stageFailureReason(dir, 'faithfulness', { exitCode: 1 })).toBe(OAUTH);
  });

  it('collapses a multi-line stderr into one bounded line', () => {
    write('market.err.txt', `Traceback:\n  line one\n  line two\n${'x'.repeat(400)}`);

    const reason = stageFailureReason(dir, 'curate.market', { exitCode: 1 });
    expect(reason).not.toContain('\n');
    expect(reason.length).toBeLessThanOrEqual(300);
    expect(reason).toMatch(/^Traceback: line one line two/);
    expect(reason.endsWith('…')).toBe(true);
  });

  it('reports the exit code for a stage that writes no claude artifacts', () => {
    expect(stageFailureReason(dir, 'merge', { exitCode: 3 })).toBe('exit 3');
  });

  it('survives an unreadable staging dir', () => {
    expect(stageFailureReason(path.join(dir, 'nope'), 'curate.market', { exitCode: 1 })).toBe(
      'exit 1',
    );
  });
});
