// Shell-level integration tests for scripts/archive-month.sh and
// scripts/hydrate-archive.sh: the real scripts run in a tmp sandbox with
// `curl` and `node` mocked via PATH, so tar / sha256sum / jq behavior is
// real but no network or git is ever touched.
//
// Pins the 2026-07-21 review findings:
//   archive-1  tar exit unchecked → corrupt tarball uploaded, month removed
//   archive-3  empty existing release poisons every rerun
//   archive-4  hydrate swallows extraction failure and reports success
//   archive-6  release-check API error treated the same as 404

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// Mock curl: routes by URL, state under $MOCK_DIR. Handles the flag shapes
// the two scripts actually use (-o, -w, -H, -X, -d, --data-binary, -fsSL).
const MOCK_CURL = `#!/usr/bin/env bash
set -u
out=""; wfmt=""; url=""; method="GET"; databin=""
args=("$@")
i=0
while [ $i -lt \${#args[@]} ]; do
  a="\${args[$i]}"
  case "$a" in
    -o) i=$((i+1)); out="\${args[$i]}" ;;
    -w) i=$((i+1)); wfmt="\${args[$i]}" ;;
    -H|-d) i=$((i+1)) ;;
    --data-binary) i=$((i+1)); databin="\${args[$i]#@}" ;;
    -X) i=$((i+1)); method="\${args[$i]}" ;;
    http://*|https://*) url="$a" ;;
  esac
  i=$((i+1))
done
echo "$method $url" >> "$MOCK_DIR/calls.log"

emit() { # $1 body, $2 http status
  if [ -n "$out" ]; then printf '%s' "$1" > "$out"; else printf '%s' "$1"; fi
  if [ -n "$wfmt" ]; then printf '%s' "$wfmt" | sed "s/%{http_code}/$2/"; fi
}

case "$url" in
  */releases/tags/*)
    tag="\${url##*/}"
    status=$(cat "$MOCK_DIR/tags/$tag.status" 2>/dev/null || echo 404)
    body=""
    [ -f "$MOCK_DIR/tags/$tag.json" ] && body=$(cat "$MOCK_DIR/tags/$tag.json")
    emit "$body" "$status"
    ;;
  */releases/assets/*)
    emit '' 204
    ;;
  */releases)
    emit '{"id": 111}' 201
    ;;
  *uploads.github.com*/assets*)
    size=$(wc -c < "$databin")
    emit "{\\"size\\": $size}" 201
    ;;
  */download/*)
    name="\${url##*/}"
    if [ -f "$MOCK_DIR/assets/$name" ]; then
      cp "$MOCK_DIR/assets/$name" "\${out:-/dev/stdout}"
    else
      exit 22
    fi
    ;;
  *)
    echo "mock curl: unhandled url $url" >&2
    exit 99
    ;;
esac
`;

// Mock node: archive-month.sh shells out to `node src/lib/commit.js --remove`;
// recording the call is all the test needs.
const MOCK_NODE = `#!/usr/bin/env bash
echo "node $*" >> "$MOCK_DIR/calls.log"
exit 0
`;

let sb;

function makeSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-sh-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data', 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'));
  const mockDir = path.join(root, 'mock');
  fs.mkdirSync(path.join(mockDir, 'tags'), { recursive: true });
  fs.mkdirSync(path.join(mockDir, 'assets'), { recursive: true });
  for (const s of ['archive-month.sh', 'hydrate-archive.sh']) {
    fs.copyFileSync(path.join(REPO_ROOT, 'scripts', s), path.join(root, 'scripts', s));
  }
  fs.writeFileSync(path.join(root, 'bin', 'curl'), MOCK_CURL, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin', 'node'), MOCK_NODE, { mode: 0o755 });
  fs.writeFileSync(path.join(mockDir, 'calls.log'), '');
  return { root, mockDir };
}

function runScript(script, args = [], env = {}) {
  return spawnSync('bash', [path.join(sb.root, 'scripts', script), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`,
      MOCK_DIR: sb.mockDir,
      GITHUB_TOKEN: 'fake-token',
      GITHUB_REPO: 'owner/repo',
      ...env,
    },
  });
}

function writeReport(name) {
  const p = path.join(sb.root, 'data', 'reports', `${name}.json`);
  fs.writeFileSync(p, `{"date":"${name}"}\n`);
  return p;
}

function setTag(tag, status, releaseJson) {
  fs.writeFileSync(path.join(sb.mockDir, 'tags', `${tag}.status`), `${status}\n`);
  if (releaseJson !== undefined) {
    fs.writeFileSync(path.join(sb.mockDir, 'tags', `${tag}.json`), JSON.stringify(releaseJson));
  }
}

function calls() {
  return fs.readFileSync(path.join(sb.mockDir, 'calls.log'), 'utf8');
}

// A month guaranteed inside hydrate's window regardless of the real date.
function monthsAgo(n) {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 7);
}

beforeEach(() => {
  sb = makeSandbox();
});

afterEach(() => {
  fs.rmSync(sb.root, { recursive: true, force: true });
});

describe('archive-month.sh', () => {
  // chmod 000 does not block reads for root, so the tar failure cannot be
  // simulated there; CI runners and dev hosts are non-root.
  it.skipIf(process.getuid?.() === 0)(
    'aborts the month when tar fails — nothing uploaded, nothing removed (archive-1)',
    () => {
      writeReport('2026-04-01');
      const blocked = writeReport('2026-04-02');
      fs.chmodSync(blocked, 0o000);

      const r = runScript('archive-month.sh', ['--ref', '2026-07-21']);

      const log = calls();
      expect(log).not.toMatch(/uploads\.github\.com/);
      expect(log).not.toMatch(/^node /m);
      expect(r.status).toBe(2);
    },
  );

  it('completes an existing empty release instead of skipping it forever (archive-3)', () => {
    writeReport('2026-04-01');
    setTag('archive-2026-04', 200, { id: 222, assets: [] });

    const r = runScript('archive-month.sh', ['--ref', '2026-07-21']);

    const log = calls();
    expect(log).toMatch(/releases\/222\/assets\?name=reports-2026-04\.tar\.gz/);
    expect(log).toMatch(/releases\/222\/assets\?name=reports-2026-04\.sha256/);
    expect(log).toMatch(/^node .*--remove .*2026-04-01\.json/m);
    expect(r.status).toBe(0);
  });

  it('replaces stale partial assets so the checksum matches the uploaded tarball (archive-3)', () => {
    writeReport('2026-04-01');
    setTag('archive-2026-04', 200, {
      id: 222,
      assets: [{ name: 'reports-2026-04.tar.gz', id: 999 }],
    });

    const r = runScript('archive-month.sh', ['--ref', '2026-07-21']);

    const log = calls();
    expect(log).toMatch(/DELETE .*releases\/assets\/999/);
    expect(log).toMatch(/releases\/222\/assets\?name=reports-2026-04\.tar\.gz/);
    expect(log).toMatch(/releases\/222\/assets\?name=reports-2026-04\.sha256/);
    expect(r.status).toBe(0);
  });

  it('treats a release-check API error as month failure, not as absent (archive-6)', () => {
    writeReport('2026-04-01');
    setTag('archive-2026-04', 500);

    const r = runScript('archive-month.sh', ['--ref', '2026-07-21']);

    const log = calls();
    expect(log).not.toMatch(/POST .*\/releases$/m);
    expect(log).not.toMatch(/^node /m);
    expect(r.status).toBe(2);
  });

  // Review finding archive-2: the monthly cron's cutoff always lands
  // mid-month, so archiving the cutoff month's early days creates a partial
  // release that release_exists then skips forever — stranding the rest of
  // that month on the hot branch permanently. Only fully-elapsed months
  // (every day past the cutoff) may be archived.
  it('leaves the partially-elapsed cutoff month alone (archive-2)', () => {
    writeReport('2026-04-30');
    writeReport('2026-05-01');
    // --ref 2026-07-10, HOT_DAYS=60 → cutoff 2026-05-11: May 1 is archivable
    // by age but May is not fully past the cutoff.
    const r = runScript('archive-month.sh', ['--ref', '2026-07-10']);

    const log = calls();
    expect(log).not.toMatch(/archive-2026-05/);
    expect(log).toMatch(/name=reports-2026-04\.tar\.gz/);
    const removeLine = log.match(/^node .*--remove.*$/m)?.[0] ?? '';
    expect(removeLine).toContain('data/reports/2026-04-30.json');
    expect(removeLine).not.toContain('2026-05-01.json');
    expect(r.status).toBe(0);
  });

  it('archives and removes a clean month end-to-end', () => {
    writeReport('2026-04-01');
    writeReport('2026-04-02');

    const r = runScript('archive-month.sh', ['--ref', '2026-07-21']);

    const log = calls();
    expect(log).toMatch(/POST .*\/releases$/m);
    expect(log).toMatch(/name=reports-2026-04\.tar\.gz/);
    expect(log).toMatch(/name=reports-2026-04\.sha256/);
    const removeLine = log.match(/^node .*--remove.*$/m)?.[0] ?? '';
    expect(removeLine).toContain('data/reports/2026-04-01.json');
    expect(removeLine).toContain('data/reports/2026-04-02.json');
    expect(r.status).toBe(0);
  });
});

describe('hydrate-archive.sh', () => {
  function stageRelease(ym, tarball) {
    const tarName = `reports-${ym}.tar.gz`;
    const shaName = `reports-${ym}.sha256`;
    fs.writeFileSync(path.join(sb.mockDir, 'assets', tarName), tarball);
    const sha = createHash('sha256').update(tarball).digest('hex');
    fs.writeFileSync(path.join(sb.mockDir, 'assets', shaName), `${sha}  ${tarName}\n`);
    setTag(`archive-${ym}`, 200, {
      id: 1,
      assets: [
        { name: tarName, browser_download_url: `https://mock.test/download/${tarName}` },
        { name: shaName, browser_download_url: `https://mock.test/download/${shaName}` },
      ],
    });
  }

  function buildTarball(ym) {
    const src = path.join(sb.root, 'tar-src');
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, `${ym}-01.json`), `{"date":"${ym}-01"}\n`);
    fs.writeFileSync(path.join(src, `${ym}-02.json`), `{"date":"${ym}-02"}\n`);
    const out = path.join(sb.root, `reports-${ym}.tar.gz`);
    execFileSync('tar', ['-czf', out, '-C', src, `${ym}-01.json`, `${ym}-02.json`]);
    return fs.readFileSync(out);
  }

  it('counts a corrupt tarball as failed instead of reporting success (archive-4)', () => {
    const ym = monthsAgo(2);
    const whole = buildTarball(ym);
    // Truncated tarball whose checksum is computed over the truncated bytes —
    // sha256sum -c passes, extraction fails (the archive-1 corruption shape).
    stageRelease(ym, whole.subarray(0, Math.floor(whole.length / 2)));

    const r = runScript('hydrate-archive.sh', [], { HYDRATE_MONTHS: '3' });

    expect(r.stdout).toMatch(/failed=1/);
    expect(r.stdout + r.stderr).toMatch(/::warning/);
    expect(fs.readdirSync(path.join(sb.root, 'data', 'reports'))).toEqual([]);
    expect(r.status).toBe(0);
  });

  it('hydrates a valid month end-to-end', () => {
    const ym = monthsAgo(2);
    stageRelease(ym, buildTarball(ym));

    const r = runScript('hydrate-archive.sh', [], { HYDRATE_MONTHS: '3' });

    expect(r.stdout).toMatch(/hydrated=1/);
    expect(r.stdout).toMatch(/failed=0/);
    const files = fs.readdirSync(path.join(sb.root, 'data', 'reports')).sort();
    expect(files).toEqual([`${ym}-01.json`, `${ym}-02.json`]);
    expect(r.status).toBe(0);
  });
});
