// Shell-level integration tests for scripts/check-faithfulness.sh. The real
// script runs against a tmp STAGING_DIR with `claude` mocked via PATH, so the
// detect → judge → apply wiring is exercised without an LLM call.
//
// Pins the 2026-08-07 finding: the judge gate was `[ -f "$PROMPT_FILE" ]` while
// the detect step only *wrote* that file when claims existed, so a prompt left
// behind by an earlier run made every later zero-claim run judge stale claims.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// Mock claude: records the invocation, emits a well-formed empty envelope.
const MOCK_CLAUDE = `#!/usr/bin/env bash
cat > "$MOCK_DIR/judge-stdin.txt"
echo "claude $*" >> "$MOCK_DIR/calls.log"
printf '%s' '{"result":"[]"}'
`;

let sb;

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'faith-sh-'));
  fs.mkdirSync(path.join(root, 'staging', 'curated', '.logs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  const mockDir = path.join(root, 'mock');
  fs.mkdirSync(mockDir);
  fs.writeFileSync(path.join(root, 'bin', 'claude'), MOCK_CLAUDE, { mode: 0o755 });
  fs.writeFileSync(path.join(mockDir, 'calls.log'), '');
  return { root, mockDir, staging: path.join(root, 'staging') };
}

function writeStaging({ editorial, curated }) {
  fs.writeFileSync(path.join(sb.staging, 'editorial.json'), JSON.stringify(editorial));
  for (const [section, body] of Object.entries(curated)) {
    fs.writeFileSync(path.join(sb.staging, 'curated', `${section}.json`), JSON.stringify(body));
  }
}

function logsPath(name) {
  return path.join(sb.staging, 'curated', '.logs', name);
}

function runScript() {
  return spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'check-faithfulness.sh')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`,
      MOCK_DIR: sb.mockDir,
      STAGING_DIR: sb.staging,
    },
  });
}

function calls() {
  return fs.readFileSync(path.join(sb.mockDir, 'calls.log'), 'utf8');
}

// Prose with no Latin name + claim verb pair → detectAttributionClaims finds nothing.
const NO_CLAIM_EDITORIAL = {
  lead: { html: '<p>記憶體供給吃緊，整個產業開始把位元組往下搬。</p>' },
  signals: { focus: [{ body: '標準層與系統層同時在動，這是供給約束的後果。' }] },
};

// A named author + claim verb in one sentence → one attribution claim.
const CLAIM_EDITORIAL = {
  lead: { html: '<p>今日無事。</p>' },
  signals: {
    focus: [
      {
        body: 'Sebastian Raschka 指出，這個模型本質上是前代的規模化生產版。',
        source_links: ['tech.models.0:raschka-teardown'],
      },
    ],
  },
};

const CURATED = {
  tech: {
    models: [
      {
        id: 'tech.models.0:raschka-teardown',
        title: 'architecture teardown',
        takeaway: '拆解文比較了兩代架構差異。',
        source: 'Sebastian Raschka',
        url: 'https://example.com/2026/08/07/teardown',
      },
    ],
  },
};

beforeEach(() => {
  sb = makeSandbox();
});

afterEach(() => {
  fs.rmSync(sb.root, { recursive: true, force: true });
});

describe('check-faithfulness.sh judge gate', () => {
  it('skips the judge when there are no attribution claims', () => {
    writeStaging({ editorial: NO_CLAIM_EDITORIAL, curated: CURATED });

    const r = runScript();

    expect(r.status).toBe(0);
    expect(calls()).toBe('');
    expect(r.stderr).toContain('attribution=0');
    expect(r.stderr).toContain('ran_judge=false');
  });

  it('does not judge a prompt left behind by an earlier run', () => {
    writeStaging({ editorial: NO_CLAIM_EDITORIAL, curated: CURATED });
    fs.writeFileSync(logsPath('faithfulness.prompt.txt'), 'Claim 0: stale claim from a past run');

    const r = runScript();

    expect(r.status).toBe(0);
    expect(calls()).toBe('');
    expect(r.stderr).toContain('ran_judge=false');
    expect(fs.existsSync(logsPath('faithfulness.prompt.txt'))).toBe(false);
  });

  it('still judges when the run has its own attribution claims', () => {
    writeStaging({ editorial: CLAIM_EDITORIAL, curated: CURATED });

    const r = runScript();

    expect(r.status).toBe(0);
    expect(calls()).toContain('claude');
    expect(r.stderr).toContain('ran_judge=true');
    expect(fs.readFileSync(path.join(sb.mockDir, 'judge-stdin.txt'), 'utf8')).toContain(
      'Sebastian Raschka',
    );
  });
});
