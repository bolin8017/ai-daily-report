# Operational reliability review — 2026-07-21

Follow-up to [2026-07-21-comprehensive-review.md](./2026-07-21-comprehensive-review.md)
(whose 14 roadmap batches all merged as PRs #126–#141). That review was a
static code audit; this one is driven by **production run evidence** — the
Hermes cron state directory
(`~/Documents/Hermes/ai-daily-report/cron-production/`: 47 recorded runs,
2026-06-04 → 2026-07-21, plus per-run logs and delivery notices) — and answers
"why do runs still fail." It also includes an adversarial review of the diff
`5d91c0c..HEAD` (the 16 fix commits merged after the comprehensive review),
which found **no new defects** (see "Post-review fix batches" below).

Severity: **H** = user-visible breakage or data loss on realistic input ·
**M** = silent misbehavior / broken contract · **L** = edge case or hygiene.
`[tested]` = observed in production logs/state, not just inferred from code.

Baseline at review time: `npm test` 557 passed / 0 failed (86 files),
`npm run lint` clean (211 files), `npm run check:sources` in sync.

## The headline number

**8 of the last 47 calendar days published no report** (verified against
`origin/data:data/reports/`):

| Missing dates | Cause |
|---|---|
| 06-30, 07-08 → 07-12 (6 days) | `curate.pulse` wrote malformed JSON; the auto-recover retry (same model, same prompt, blind re-run after 30 min) failed the same way; nobody backfilled (ops-1) |
| 07-02, 07-03 (2 days) | No run record at all — the Hermes cron never fired (host down); no gap detection or catch-up exists (ops-2) |

Additionally 07-20's report published but the site did not rebuild until the
next day (ops-3), and the 市場 tab shipped **empty** on 5 of the last 14 runs
(ops-4).

What is genuinely healthy: auto-recovery does its job for *transient*
failures — 7 runs recovered on the single retry (06-09, 06-11, 06-19, 06-23,
07-01, 07-13, 07-21, all `curate.pulse`); the publish tail (validate → remote
verify → dispatch) caught every partial failure it was designed to catch; and
the 16 post-review fix commits are clean.

## Cross-cutting theme

**The retry policy models exactly one failure class.** `retry-self`
(`src/pipeline/stages.js:32-41`) re-runs the identical command once after
`AUTORECOVER_RETRY_DELAY_MIN` (30 min) — a design tuned for API-side
transients (529/overload). But the dominant production failure is now
*output-shape* failure (malformed curator JSON, zero-item curations), where a
blind identical retry has roughly the same failure probability as the first
attempt — proven by the 07-08 → 07-12 streak where both attempts failed five
days running. Output-shape failures need feedback (re-prompt with the error)
or escalation (fallback model), not repetition.

---

## Findings

### ops-1 · **H** · `[tested]` — malformed curator JSON has no repair path
`scripts/curate.sh:117-129` — the curator (Haiku) writes
`data/staging/curated/pulse.json` directly via the Write tool; validation
runs `JSON.parse` on it and any parse error exits rc=2 → critical section →
day aborted. The only recovery is the sequencer's blind `retry-self`.
**Production evidence:** 13 of 47 runs had `curate.pulse` fail at least once.
Six of those (06-30, 07-08 → 07-12) failed the retry too — logs show the
identical error each time (`Expected ',' or '}' after property value in JSON
at position 4143/4180/4555/4929/4975…` — an unescaped-quote/truncation class
error consistently ~4-5 KB in), i.e. five consecutive days lost to the same
correctable failure.
**Fix direction:** on parse/validate failure (a) try a deterministic JSON
repair first (e.g. the `jsonrepair` package); (b) if that fails, one
re-invocation that feeds the previous output + the exact parse/Zod error back
to the model ("repair this JSON"); (c) escalate the second attempt to
`CURATE_FALLBACK_MODEL` (sonnet — the variable already exists at
`scripts/curate.sh:21` but is only wired as `--fallback-model` for API
availability, not validation failure). Any one of these would very likely
have saved all six lost days.

### ops-2 · **H** · `[tested]` — no missed-day detection or catch-up
07-02 and 07-03 have no run record, no notice, no report — the scheduler
(session-level Hermes cron; no crontab/systemd unit on the host) simply never
fired, and nothing anywhere notices a calendar gap after the fact. Failed
days similarly stay unfilled unless an operator happens to look (06-30's
failure notice fired, but the day was never backfilled).
**Failure scenario:** host is off/asleep at 08:30 → the day silently never
exists; readers see a hole in the archive.
**Fix direction:** (a) at the start of each production run, diff the last N
calendar days against `origin/data:data/reports/` and emit a "missing:
YYYY-MM-DD" notice (cheap, repo-side, catches both causes); (b) document the
backfill path (`production-run.js run --recover-from …` covers same-day
resume but there is no documented "regenerate yesterday" recipe); (c)
optionally an anacron-style catch-up in the cron wrapper (infra-side).

### ops-3 · **M** · `[tested]` — Pages dispatch is a single unretried curl
`src/ops/production-run.js:252-276` — `dispatchPages` is one `curl -fsS`
POST; any HTTP failure returns non-zero and the whole run is marked failed.
**Production evidence:** 07-20 — pipeline, validate, remote verify all green
(`rc={run:0,validate:0,remote:0}`), then GitHub returned 503 → curl rc=22 →
`final:22`, "FAILED" notice, and the published report was not deployed until
the next day's run pushed.
**Fix direction:** bounded retry with backoff (3 × ~30 s covers routine API
blips); on persistent failure emit a *distinct* "report published but deploy
dispatch failed — run workflow_dispatch manually" notice instead of the
generic failure, since the data-branch push already succeeded.

### ops-4 · **M** · `[tested]` — zero-item curator output passes silently
`src/pipeline/run.js:113-118` classifies a validated-but-empty curate output
as `suspicious-empty`, but `AVAILABLE` (`:19`) treats that status as success:
no retry, downstream proceeds, the tab ships empty.
**Production evidence:** `curate.market` emitted `items=0` on 07-08, 07-13,
07-16, 07-19, 07-20 — 5 of the last 14 runs. Today's run curated 16 items
from a 170-item staging slice of comparable size, so "nothing qualified" five
times in two weeks is implausible; this is curator behavior (over-filtering
or output loss), not thin news. (`curate.discoveries` showed the same status
on 06-20/06-21.) Root cause is currently unrecoverable because the failing
runs' artifacts were overwritten — see ops-5.
**Fix direction:** treat `suspicious-empty` as retryable for curate stages
(one retry, same escalation ladder as ops-1); keep the day alive if the
retry still comes back empty (current behavior) but make the notice trend
visible. Investigate the market curator prompt once ops-5 preserves a
failing specimen.

### ops-5 · **L** — failure artifacts are overwritten before anyone can look
`scripts/curate.sh:50-53` — prompt, raw envelope, and the invalid output all
live at fixed per-section paths under `data/staging/curated/.logs/`,
overwritten every run. The malformed JSON from the 07-08 → 07-12 streak and
the empty market outputs are gone; every recurrence starts diagnosis from
zero.
**Fix direction:** on validation failure (or suspicious-empty), copy
`{prompt,raw,output}` into a dated quarantine dir
(`data/staging/curated/.failures/YYYY-MM-DD/` or the state dir) before
returning.

### ops-6 · **L** — documented schedule drifted from reality
CLAUDE.md ("Deployment mode", "Notes") and README say the cron runs at
**07:00 Asia/Taipei**; every run since 06-11 starts at 00:30 UTC =
**08:30 Asia/Taipei** (run ids `*003005`-style, state-dir timestamps).
Harmless until someone builds on the documented time (e.g. "report ready by
07:30" assumptions). **Fix:** update the docs (or move the cron back —
operator's call; docs should match whichever).

## Post-review fix batches (`5d91c0c..HEAD`, PRs #126–#141)

Adversarial re-review of the 16 fix commits found **no new defects, no
incomplete fixes, no regressions**. Specifically verified and held up: the
archive tar-integrity + fully-elapsed-month gates, the three ledger
absent-vs-corrupt/shrink guards (they cannot block a legitimate write), the
`source_links` canonical rewrite, the same-day-rerun `first_shown` logic
(timezone-consistent), the curl token-off-argv change (no auth broken), and
the `feeds.ok` derivation. Two hygiene-level observations survive:

### diff-1 · **L**
`src/lib/site-url.js:54-59` — `rfc822Date` has no invalid-date guard; a
malformed `report.date` would render `"undefined, NaN undefined NaN …"` in
the feed. Unreachable today (schema-validated upstream); one-line guard if
hardening.

### diff-2 · **L** (watch-item, not a code bug)
`src/lib/star-history.js:87-92` — on a host where `refs/remotes/origin/data`
was never fetched, provenance is `unavailable` every run and `recordSnapshot`
skips forever (loudly logged, and strictly safer than the old silent
overwrite). Re-provisioned-host checklist should include `git fetch origin
data`.

## Dimensions with nothing found

- Code-level dimensions (1–7 of the comprehensive review): covered this
  morning; the fix diff re-review above found nothing new.
- Publish tail correctness (validate → remote verify → dispatch): behaved
  correctly in all 47 runs — every "failed" state was a genuine failure.

---

## Roadmap

Severity order; one batch = one concern = one PR. Batch 2 is repo-side gap
*detection*; actual missed-day scheduling resilience is infra (Hermes cron
wrapper) and out of repo scope. Batch 4 reuses batch 1's retry plumbing —
start it after batch 1 merges.

| # | Batch (proposed PR) | Findings | Size |
|---|---|---|---|
| 1 | `fix(curate): repair malformed curator JSON instead of blind retry` — deterministic repair pass, error-feedback re-prompt, fallback-model escalation on validation failure | ops-1 **H** | ~150 |
| 2 | `feat(ops): detect missing report days at run start` — diff calendar vs origin/data, emit notice; document the backfill recipe | ops-2 **H** | ~100 |
| 3 | `fix(ops): retry Pages dispatch with backoff; distinct published-but-undeployed notice` | ops-3 | ~60 |
| 4 | `fix(curate): retry suspicious-empty curator output` (after batch 1) | ops-4 | ~80 |
| 5 | `feat(curate): quarantine failed curator artifacts for post-mortem` | ops-5 | ~40 |
| 6 | `docs: correct cron schedule; add re-provision fetch step` | ops-6, diff-2 | ~20 |
| 7 | `fix(site): guard rfc822Date against invalid dates` | diff-1 | ~20 |
