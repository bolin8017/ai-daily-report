# Hermes ↔ production runner integration

> **Audience: Hermes (the cron operator).** This explains how to migrate the two
> ai-daily-report production cron scripts to the repo-owned production runner.
> The repo now owns pipeline semantics (run, auto-recovery, validate, verify,
> dispatch, structured state, monitor rendering). Hermes keeps only what it is
> good at: **schedule, launch+detach, lock, git sync, and Telegram delivery.**
>
> **Cron schedules do not change.** Only the two script bodies change.

## Compatibility note — condense redesign (2026-06-05, PRs #90–#95)

The section-aware condense rework — an `interests.yaml` subscription registry,
per-section staging slices replacing the single unified condensed feed,
topic-locked arXiv via the search API, and curators reading those slices — is
**entirely internal to Stage 1 (collect/condense) and Stage 2 (curate)**, both of
which run inside `run.sh --full` behind `production-run.js`. **No wrapper,
schedule, env var, or state-contract change is required.** Concretely:

- The new config lives at `themes/<ACTIVE_THEME>/interests.yaml`, committed on
  `main` — it arrives through the existing `git pull --ff-only origin main` in the
  start wrapper. Nothing to provision on the Hermes side.
- Staging gained per-section slices plus a `feeds_sections` item-count map in
  `metadata.json`. Hermes never reads staging, so this is invisible to the wrappers.
- The pipeline stage list (`collect → curate → context → synthesize →
  faithfulness → merge`), the `latest.json` shape, monitor output, flock, detach,
  and Telegram delivery are all unchanged.

If the migration in this doc has not been applied on the Hermes side yet, it
remains valid exactly as written below.

## Aggregator dependency — Miniflux + RSSHub (deployed 2026-06-06, PR #96)

**Did the operator-facing contract change? No.** Cron schedules, the two wrapper
scripts, the `latest.json` state contract, monitor output, flock/detach, and
Telegram delivery are all unchanged. What changed is internal to Stage 1 plus one
new standing infrastructure dependency — **already deployed and boot-persistent**,
so there is nothing for the wrappers to do differently.

**What changed:** Stage 1 now ingests the native-RSS feed half (~37 blog/media
feeds) from a **self-hosted Miniflux** (fed by a self-hosted RSSHub) instead of
per-source RSS chains. `collect.js` partitions sources by
`themes/<theme>/feeds.opml`: those feeds come from one Miniflux pull, everything
else (HN/Lobsters, the RSSHub-only `dev-to-top`/`anthropic-news`, slow
`sk-hynix-news`, and all structured sources) still fetches via its chain.

**Current steady state on the production host (server14) — already in place, no setup pending:**

- The stack runs via `docker/aggregator/docker-compose.yml` (RSSHub + Miniflux +
  Postgres, host networking, all bound to `127.0.0.1` — not publicly exposed). All
  three containers use `restart: unless-stopped` and the docker daemon is enabled
  at boot, so **the stack returns automatically after a reboot** — no operator
  action required.
- `MINIFLUX_URL` + `MINIFLUX_USERNAME`/`MINIFLUX_PASSWORD` (or `MINIFLUX_TOKEN`)
  live in the repo `.env` — same checkout and same file as `GITHUB_TOKEN`, which the
  start wrapper already sources. See `.env.example`.

**The only operator touchpoints (rare, manual — not part of the daily cron):**

- Changed the feed list (edited `feeds.opml`): re-run `node scripts/miniflux-sync.mjs`
  (idempotent). To rebuild/retag every feed from scratch: add `--reset`.
- Stack somehow not running: `docker compose -f docker/aggregator/docker-compose.yml up -d`.

**Failure behavior (no new alerting needed):** if Miniflux is unreachable at collect
time, the native-RSS feed half is empty for that run and listed in
`metadata.json → degraded` (`miniflux-feeds`); HN/Lobsters, shipped, and all
structured sources still produce a report and `run.sh --full` still exits 0, so the
monitor's success/failure logic is unchanged. If Miniflux is not configured at all
(e.g. a dev checkout without the stack), collect falls back to chain-fetching
everything.

## What changed in the repo (so the wrappers can shrink)

| Capability | Where it lives now |
|---|---|
| Drive the pipeline (collect → curate → context → synthesize → faithfulness → merge) | `scripts/run.sh --full` → `src/pipeline/run.js` sequencer |
| **Auto-recover a transient stage failure** | sequencer `--auto-recover` (baked into `run.sh --full`); one bounded retry of a `failed` retryable stage + its downstream. Deterministic stages (context/merge/faithfulness) are never retried, so no wasted tokens. |
| Publish tail: validate report → verify `origin/data` has today's report → dispatch the Pages build | `node src/ops/production-run.js run` |
| Structured run state (`latest.json` / `runs/<id>.json`) | written by `production-run.js run` under `--state-dir` |
| Monitor rendering (success/30m/60m/failure/orphan notices, once each) | `node src/ops/production-run.js monitor --state-dir <D>` |
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
`$STATE_DIR/notices/<run_id>-{success,30m,60m,failed,orphan}`.

## What the monitor prints (every 15 min, side-effect-light)

- **succeeded** → one concise completion notice with the report date, run IDs,
  duration, any `auto-recovered:` stages, and the live report URL.
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
