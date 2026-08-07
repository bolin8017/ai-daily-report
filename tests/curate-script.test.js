// Shell-level integration tests for scripts/curate.sh. The real script runs
// against a tmp CURATED_DIR with `claude` mocked via PATH, so the exit-code
// contract is exercised without an LLM call.
//
// Pins the 2026-08-07 finding (cur-1): the sequencer invokes this script one
// section at a time (stages.js: ['bash','scripts/curate.sh', s]) and declares
// all four curators `required`, but the exit code was still decided by the
// batch-mode CRITICAL list — so a market/tech failure exited 0 and the stage's
// only remaining signal was satisfied()'s output check, which accepts a
// syntactically valid file that failed its own schema.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// Mock claude: identifies the target section from the prompt on stdin (every
// curator prompt names its own output path), fails for the sections listed in
// MOCK_FAIL_SECTIONS, and otherwise emits that section's prepared envelope.
const MOCK_CLAUDE = `#!/usr/bin/env bash
IN=$(cat)
SEC=""
for s in discoveries pulse market tech; do
  if printf '%s' "$IN" | grep -q "curated/$s.json"; then SEC="$s"; break; fi
done
case " \${MOCK_FAIL_SECTIONS:-} " in
  *" $SEC "*) echo "mock claude: simulated failure for $SEC" >&2; exit 1 ;;
esac
cat "$MOCK_ENVELOPE_DIR/$SEC.json"
`;

// Minimal outputs that satisfy each section's curated sub-schema.
const VALID = {
  discoveries: { rising: [], dev_watch: [] },
  pulse: { hn: [], lobsters: [], chinese_community: [], ai_bloggers: [] },
  market: { ma: [], funding: [], taiwan: [] },
  tech: { vendor: [], models: [], benchmarks: [], aidaptiv: [] },
};

// Syntactically valid JSON that violates MarketCuratedSchema — the residue a
// jsonrepair pass leaves behind once it has fixed the syntax but not the shape.
const SCHEMA_INVALID_MARKET = { ma: [{ nope: 1 }], funding: [], taiwan: [] };

let sb;

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'curate-sh-'));
  const staging = path.join(root, 'staging');
  const curated = path.join(staging, 'curated');
  const envelopes = path.join(root, 'envelopes');
  fs.mkdirSync(path.join(curated, '.logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(envelopes);
  fs.writeFileSync(path.join(root, 'bin', 'claude'), MOCK_CLAUDE, { mode: 0o755 });
  return { root, staging, curated, envelopes };
}

// `claude -p --output-format json` prints an envelope whose .result carries the
// model's final text; curate.sh recovers the output file from it when the Write
// tool did not produce one.
function setEnvelope(section, body) {
  fs.writeFileSync(
    path.join(sb.envelopes, `${section}.json`),
    JSON.stringify({ result: JSON.stringify(body) }),
  );
}

function runCurate(sections, env = {}) {
  return spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'curate.sh'), ...sections], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`,
      STAGING_DIR: sb.staging,
      CURATED_DIR: sb.curated,
      MOCK_ENVELOPE_DIR: sb.envelopes,
      WATCHDOG_CHECK_INTERVAL_SEC: '1',
      ...env,
    },
  });
}

beforeEach(() => {
  sb = makeSandbox();
  for (const [section, body] of Object.entries(VALID)) setEnvelope(section, body);
});
afterEach(() => {
  fs.rmSync(sb.root, { recursive: true, force: true });
});

describe('curate.sh per-section invocation (the sequencer path)', () => {
  it('exits non-zero when a non-critical section fails', () => {
    const r = runCurate(['market'], { MOCK_FAIL_SECTIONS: 'market' });
    expect(r.stdout).toMatch(/market FAILED/);
    expect(r.status).not.toBe(0);
  });

  it('exits non-zero when a critical section fails', () => {
    const r = runCurate(['pulse'], { MOCK_FAIL_SECTIONS: 'pulse' });
    expect(r.status).not.toBe(0);
  });

  it('exits zero when the requested section succeeds', () => {
    const r = runCurate(['market']);
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(sb.curated, 'market.json'), 'utf8'))).toEqual(
      VALID.market,
    );
  });

  // The exit code is the sequencer's first signal (run.js classify() checks it
  // before the output check), but a file left behind by a failed curation also
  // has to fail satisfied()'s fresh-outputs check — otherwise a later --resume
  // or --recover-from marks the stage satisfied and merge consumes output that
  // Stage 2's own validator rejected.
  it('removes an output that still fails validation after the LLM repair', () => {
    setEnvelope('market', SCHEMA_INVALID_MARKET);
    const r = runCurate(['market']);
    expect(r.stdout).toMatch(/VALIDATION FAILED/);
    expect(r.status).not.toBe(0);
    expect(fs.existsSync(path.join(sb.curated, 'market.json'))).toBe(false);
  });

  it('quarantines the rejected output before removing it', () => {
    setEnvelope('market', SCHEMA_INVALID_MARKET);
    runCurate(['market']);
    const failures = path.join(sb.curated, '.logs', 'failures');
    const day = fs.readdirSync(failures)[0];
    expect(JSON.parse(fs.readFileSync(path.join(failures, day, 'market.json'), 'utf8'))).toEqual(
      SCHEMA_INVALID_MARKET,
    );
  });
});

describe('curate.sh batch invocation (no section arguments)', () => {
  it('does not abort on a lone non-critical failure', () => {
    const r = runCurate([], { MOCK_FAIL_SECTIONS: 'market' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/non-critical section 'market' failed/);
  });

  it('aborts when a critical section fails', () => {
    const r = runCurate([], { MOCK_FAIL_SECTIONS: 'pulse' });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/critical section 'pulse' failed/);
  });
});
