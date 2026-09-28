// Shell-level tests for the two Stage 2.5/3 scripts — scripts/context.sh and
// scripts/synthesize.sh — covering their exit-code contracts.
//
// `node` and `claude` are stubbed via PATH, so the LLM call and the prompt
// builder never run; what is exercised is the shell's own decisions: the
// critical-input check, and whether each downstream failure is propagated or
// swallowed. The sequencer classifies a stage by its exit code, so a swallowed
// failure here means a stage reports ok on work that did not happen.
//
// synthesize.sh has no `cd` of its own (unlike every other script here) — it
// inherits the caller's cwd from run.sh. The sandbox reproduces that by
// spawning with cwd set to the sandbox root.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// node shim: fails when argv matches STUB_FAIL; stubs only the helper scripts
// that would need a Wiki, a prompt bundle or an LLM envelope, and hands
// everything else to the real node. That keeps the repair pass and the
// EditorialSchema check real, so the exit-2 validation branch is genuinely
// exercised rather than asserted against a stub's exit code.
// The --output stub writes the file its caller will immediately read.
const NODE_STUB = `#!/usr/bin/env bash
echo "node $*" >> "$RUN_LOG"
case "$*" in
  *"\${STUB_FAIL:-__never__}"*) echo "stub node failure: $*" >&2; exit 1 ;;
esac
case "$*" in
  *build-report-context*|*build-synthesizer-prompt*|*"claude-envelope.js sidecar"*)
    prev=""
    for a in "$@"; do
      if [ "$prev" = "--output" ]; then mkdir -p "$(dirname "$a")"; printf 'prompt' > "$a"; fi
      prev="$a"
    done
    exit 0
    ;;
esac
exec "$REAL_NODE" "$@"
`;

// claude stub: prints a json envelope whose .result is MOCK_EDITORIAL (the
// synthesizer's reply is the editorial), or an empty result when unset, so the
// "returned no editorial" branch is reachable by leaving it unset.
const CLAUDE_STUB = `#!/usr/bin/env bash
cat > /dev/null
echo "claude $*" >> "$RUN_LOG"
if [ "\${MOCK_CLAUDE_RC:-0}" != "0" ]; then exit "$MOCK_CLAUDE_RC"; fi
MOCK_EDITORIAL="\${MOCK_EDITORIAL:-}" "$REAL_NODE" -e 'process.stdout.write(JSON.stringify({ result: process.env.MOCK_EDITORIAL }))'
exit 0
`;

// synthesize.sh derives TODAY the same way; keep the editorial's own date in
// step with it so the fixture cannot go stale.
const DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());

const VALID_EDITORIAL = JSON.stringify({
  schema_version: '2.1-editorial',
  date: DATE,
  theme: 'ai-builder',
  lead: { html: '<p>lead</p>' },
  signals: { focus: [], predictions: [] },
});

// Right shape, wrong schema_version — the residue of a synthesizer that wrote
// something plausible the repair pass cannot fix.
const INVALID_EDITORIAL = JSON.stringify({
  schema_version: 'nope',
  date: DATE,
  theme: 'ai-builder',
  lead: { html: '<p>lead</p>' },
  signals: { focus: [], predictions: [] },
});

let sb;

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'synth-sh-'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'scripts', 'hermes'), { recursive: true });
  const curated = path.join(root, 'data', 'staging', 'curated');
  fs.mkdirSync(curated, { recursive: true });

  for (const s of ['context.sh', 'synthesize.sh', 'watchdog.sh']) {
    fs.symlinkSync(path.join(REPO_ROOT, 'scripts', s), path.join(root, 'scripts', s));
  }
  // src/ and themes/ are read by the real script paths; node is stubbed, so
  // these only need to exist for the path checks the shell itself performs.
  for (const dir of ['src', 'themes']) {
    fs.symlinkSync(path.join(REPO_ROOT, dir), path.join(root, dir));
  }
  fs.writeFileSync(path.join(root, 'bin', 'node'), NODE_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin', 'claude'), CLAUDE_STUB, { mode: 0o755 });

  // Both critical curated inputs present by default.
  for (const sec of ['discoveries', 'pulse']) {
    fs.writeFileSync(path.join(curated, `${sec}.json`), '{}');
  }
  return { root, curated, log: path.join(root, 'run.log') };
}

function run(script, env = {}) {
  return spawnSync('bash', [path.join(sb.root, 'scripts', script)], {
    cwd: sb.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`,
      RUN_LOG: sb.log,
      REAL_NODE: process.execPath,
      ...env,
    },
  });
}

beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  fs.rmSync(sb.root, { recursive: true, force: true });
});

describe('context.sh', () => {
  it('exits 0 when the context builder succeeds', () => {
    const r = run('context.sh');
    expect(r.status).toBe(0);
    expect(fs.readFileSync(sb.log, 'utf8')).toMatch(/build-report-context\.mjs/);
  });

  // The sequencer reads this exit code; swallowing it would let Stage 3 run
  // against a context file that was never written.
  it('exits 3 when the context builder fails', () => {
    const r = run('context.sh', { STUB_FAIL: 'build-report-context' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/report-context generation failed/);
  });
});

describe('synthesize.sh', () => {
  it('exits 3 when a critical curated input is missing', () => {
    fs.rmSync(path.join(sb.curated, 'pulse.json'));
    const r = run('synthesize.sh', { MOCK_EDITORIAL: VALID_EDITORIAL });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/Missing critical pulse\.json/);
  });

  it('exits 3 when prompt generation fails', () => {
    const r = run('synthesize.sh', { STUB_FAIL: 'build-synthesizer-prompt' });
    expect(r.status).toBe(3);
    expect(r.stderr).toMatch(/prompt generation failed/);
  });

  it('exits 1 when claude fails', () => {
    const r = run('synthesize.sh', { MOCK_CLAUDE_RC: '7' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/claude -p failed rc=7/);
  });

  // An expensive call that produced no editorial is the failure this catches:
  // claude exits 0 with an empty reply. A stale editorial from an earlier run
  // must not survive to be validated in its place.
  it('exits 2 when claude succeeds without returning an editorial', () => {
    const editorial = path.join(sb.root, 'data', 'staging', 'editorial.json');
    fs.writeFileSync(editorial, VALID_EDITORIAL);
    const r = run('synthesize.sh');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/returned no editorial/);
    expect(fs.existsSync(editorial)).toBe(false);
  });

  it('writes the editorial from a fenced reply', () => {
    const r = run('synthesize.sh', { MOCK_EDITORIAL: `\`\`\`json\n${VALID_EDITORIAL}\n\`\`\`` });
    expect(r.status).toBe(0);
    const written = fs.readFileSync(
      path.join(sb.root, 'data', 'staging', 'editorial.json'),
      'utf8',
    );
    expect(JSON.parse(written).schema_version).toBe('2.1-editorial');
  });

  // The last line of defense on an expensive call: the file exists and parses,
  // but is not what Stage 4 can merge. Real node runs this check.
  it('exits 2 when the editorial fails schema validation', () => {
    const r = run('synthesize.sh', { MOCK_EDITORIAL: INVALID_EDITORIAL });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/EDITORIAL VALIDATION FAILED/);
  });

  it('exits 0 and validates a well-formed editorial', () => {
    const r = run('synthesize.sh', { MOCK_EDITORIAL: VALID_EDITORIAL });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/editorial validates against EditorialSchema/);
  });

  // The repo's CLAUDE.md is developer documentation; keeping it out of the
  // synthesizer's context saves ~18K input tokens a call.
  it("excludes the repo's CLAUDE.md from the claude call", () => {
    run('synthesize.sh', { MOCK_EDITORIAL: VALID_EDITORIAL });
    const call = fs
      .readFileSync(sb.log, 'utf8')
      .split('\n')
      .find((l) => l.startsWith('claude '));
    expect(call).toContain(`"claudeMdExcludes":["${sb.root}/CLAUDE.md"]`);
  });
});
