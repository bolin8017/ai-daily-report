# Hermes ↔ production runner integration

> **Audience: Hermes (the cron operator).** This explains how to migrate the two
> ai-daily-report production cron scripts to the repo-owned production runner.
> The repo now owns pipeline semantics (run, auto-recovery, validate, verify,
> dispatch, structured state, monitor rendering). Hermes keeps only what it is
> good at: **schedule, launch+detach, lock, git sync, and Telegram delivery.**
>
> **Cron schedules do not change.** Only the two script bodies change.

## What changed in the repo (so the wrappers can shrink)

| Capability | Where it lives now |
|---|---|
| Drive the pipeline (collect → curate → context → synthesize → faithfulness → merge) | `scripts/run.sh --full` → `src/pipeline/run.js` sequencer |
| **Auto-recover a transient stage failure** | sequencer `--auto-recover` (baked into `run.sh --full`); one bounded retry of a `failed` retryable stage + its downstream. Deterministic stages (context/merge/faithfulness) are never retried, so no wasted tokens. |
| Publish tail: validate report → verify `origin/data` has today's report → dispatch the Pages build | `node src/ops/production-run.js run` |
| Structured run state (`latest.json` / `runs/<id>.json`) | written by `production-run.js run` under `--state-dir` |
| Monitor rendering (silent on success; 30m/60m/failure/orphan notices, once each) | `node src/ops/production-run.js monitor --state-dir <D>` |
| Manual operator recovery (re-run a stage + downstream, then publish) | `bash scripts/run.sh --recover-from <stage>` |

The runner is **synchronous**: `production-run.js run` blocks for the whole
pipeline (~20 min). Hermes must still launch it **detached** so cron's
~120 s `no_agent` script timeout doesn't fire. `GITHUB_TOKEN` (from the repo
`.env`) is read only for the Pages dispatch and is never written to the log or
state JSON.

## New script bodies (replace the two files wholesale)

Paths used below (unchanged from the current scripts):

- `REPO = /home/bolin8017/Documents/repositories/ai-daily-report`
- `STATE_DIR = /home/bolin8017/Documents/Hermes/ai-daily-report/cron-production`
- `WIKI_ROOT = /home/bolin8017/Documents/Hermes/Wiki/ai-daily-report`

### `~/.hermes/scripts/ai-daily-report-prod-start.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="/home/bolin8017/Documents/repositories/ai-daily-report"
STATE_DIR="/home/bolin8017/Documents/Hermes/ai-daily-report/cron-production"
WIKI_ROOT="/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report"
mkdir -p "$STATE_DIR" "$WIKI_ROOT"

if [ "${SELFTEST:-0}" = "1" ]; then
  echo "[ai-daily-report production] selftest ok: thin start wrapper installed."
  exit 0
fi

# Launch detached so the launcher returns immediately (cron's no_agent job has a
# ~120s script timeout; the run takes ~20 min). The flock is acquired INSIDE the
# subshell and held for the whole run, so a second cron tick while a run is
# active simply finds the lock taken and exits — no overlap, no extra state file.
(
  exec 9>"$STATE_DIR/start.lock"
  if ! flock -n 9; then
    exit 0   # a run is already active
  fi
  exec >>"$STATE_DIR/launch.log" 2>&1 </dev/null
  cd "$REPO" || exit 10
  git checkout main
  git pull --ff-only origin main
  if [ -f .env ]; then
    # shellcheck source=/dev/null
    set -a; source .env; set +a   # GITHUB_TOKEN for the Pages dispatch
  fi
  export REPORT_TIMEZONE="${REPORT_TIMEZONE:-Asia/Taipei}"
  node src/ops/production-run.js run \
    --state-dir "$STATE_DIR" \
    --wiki-root "$WIKI_ROOT"
) &

echo "[ai-daily-report production] started (thin wrapper) pid=$! state=$STATE_DIR/latest.json"
echo "monitor: every 15 minutes via production-run.js monitor."
```

### `~/.hermes/scripts/ai-daily-report-prod-monitor.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="/home/bolin8017/Documents/repositories/ai-daily-report"
STATE_DIR="/home/bolin8017/Documents/Hermes/ai-daily-report/cron-production"

if [ "${SELFTEST:-0}" = "1" ]; then
  echo "[ai-daily-report production monitor] selftest ok: thin monitor wrapper installed."
  exit 0
fi

cd "$REPO"
exec node src/ops/production-run.js monitor --state-dir "$STATE_DIR"
```

Whatever the monitor prints on stdout is the Telegram message; empty output =
stay silent (Hermes already treats no-output as nothing-to-deliver).

## State contract (`$STATE_DIR/latest.json`)

`production-run.js run` writes this atomically — `status: "running"` at launch,
then the terminal state at the end:

```json
{
  "schema_version": 1,
  "run_id": "20260605070000",
  "repo_run_id": "6df9a24d-…",
  "status": "running | succeeded | failed",
  "report_date": "2026-06-05",
  "started_at": "…", "ended_at": "…", "duration_ms": 1392000,
  "pid": 12345,
  "log_file": "…/logs/20260605070000.log",
  "skip_push": false,
  "stages": { "curate.market": { "status": "ok", "cost_usd": 0.01, "tokens": 1840, "error": null }, "…": {} },
  "recovery": { "retried": ["curate.market"] },
  "publish": { "attempted": true, "report_present_remote": true, "dispatch_rc": 0 },
  "rc": { "run": 0, "validate": 0, "remote": 0, "dispatch": 0, "final": 0 }
}
```

Per-run copies are kept at `$STATE_DIR/runs/<run_id>.json`; logs at
`$STATE_DIR/logs/<run_id>.log`. Notice de-dup markers live in
`$STATE_DIR/notices/<run_id>-{30m,60m,failed,orphan}`.

## What the monitor prints (every 15 min, side-effect-light)

- **succeeded** → nothing (production success is silent, owner policy).
- **running** and pid alive, < 30 min → nothing.
- **running** and pid alive, ≥ 30 min / ≥ 60 min → one "still running" notice at
  each threshold.
- **running** but the runner pid is **dead** → one "orphaned run" notice
  (process ended without writing a final state).
- **failed** → one concise failure report (rc breakdown + per-stage summary +
  log path; `auto-recovered:` line if a stage was retried).

Each notice is emitted at most once (marker files). Monitor never triggers
recovery — auto-recovery is the sequencer's job inside the run.

## Migration steps

```bash
cd ~/.hermes/scripts
cp ai-daily-report-prod-start.sh   ai-daily-report-prod-start.sh.bak
cp ai-daily-report-prod-monitor.sh ai-daily-report-prod-monitor.sh.bak
# replace both bodies with the versions above, then:
chmod +x ai-daily-report-prod-start.sh ai-daily-report-prod-monitor.sh
bash -n ai-daily-report-prod-start.sh && bash -n ai-daily-report-prod-monitor.sh
SELFTEST=1 ./ai-daily-report-prod-start.sh
SELFTEST=1 ./ai-daily-report-prod-monitor.sh
```

Leave `~/.hermes/cron/jobs.json` untouched: `prod-start` stays `0 7 * * *`,
`prod-monitor` stays `every 15m`.

**Rollback:** restore the `.bak` files. The old `running.env` / `done-*.env`
state model and the new `latest.json` model don't collide (different files), so
a rollback mid-day is safe.

## Optional: no-push rehearsal before trusting it live

Runs the real pipeline (~20 min, real LLM tokens) but publishes nothing —
validates the local report and writes dry-run state:

```bash
cd "$REPO"
node src/ops/production-run.js run \
  --state-dir /home/bolin8017/Documents/Hermes/ai-daily-report/cron-dry-run \
  --wiki-root "$WIKI_ROOT" \
  --skip-push
node src/ops/production-run.js status \
  --state-dir /home/bolin8017/Documents/Hermes/ai-daily-report/cron-dry-run --json
```

Expect `status: "succeeded"`, `rc.final: 0`, `skip_push: true`, and no push to
`origin/data`.

## Old → new responsibility map

| Old prod-start.sh did | Now |
|---|---|
| flock guard | kept (moved inside the detached subshell, held for the whole run) |
| generate Hermes RUN_ID | `production-run.js` generates `run_id`; `repo_run_id` links to the sequencer |
| detached bg launch | kept (the one bit Hermes must keep — cron timeout) |
| git checkout/pull | kept in the wrapper |
| `run.sh --full` | called by `production-run.js run` (now with `--auto-recover`) |
| validate / verify origin/data / dispatch | `production-run.js run` |
| write `done-<id>.env` | `production-run.js` writes `latest.json` + `runs/<id>.json` |
| prod-monitor parsing `.env` + Python log scan | `production-run.js monitor` reads `latest.json` |
