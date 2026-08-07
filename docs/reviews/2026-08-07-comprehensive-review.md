# Comprehensive repo review — 2026-08-07

Sixteen days after the [2026-07-22 delta review](./2026-07-22-comprehensive-review.md),
whose roadmap batches 1–7 all merged (PRs #151–#157, #160, #165; batch 8 remains
deliberately deferred). Since then the repo took 11 more commits, three of them
landing **today** (PRs #164, #165, #167) and therefore never exercised by a
production run — the 2026-08-07 cron fired at 08:30 against `e4af463`, hours
before they merged.

Scope: a full pass rather than a delta. Every subsystem was re-read
(collect + fetchers, lib, pipeline, ops, curators + schemas, scripts, site/11ty,
themes, tests, CI, docker), with extra weight on (a) the three unreviewed
same-day commits, (b) the ledger/hardening sweeps the two prior reviews
prescribed, checked for files those sweeps skipped, and (c) production evidence
from 63 recorded runs including the 2026-07-31 → 08-06 outage.

Severity: **H** = user-visible breakage or data loss on realistic input ·
**M** = silent misbehavior / broken contract · **L** = edge case or hygiene.
`[tested]` = reproduced empirically in a temp dir, or observed in production
evidence.

Baseline at review time: `npm test` 612 passed / 0 failed (90 files),
`npm run lint` clean (218 files), `npm run check:sources` in sync (10/10).

## Headline

**One High, five Medium.** The High is a cross-day data-loss path in
`seen-repos.js`: the 2026-07-21 ledger-guard fix (#127) named all three
persistent ledgers in its commit body, gave `star-history.js` and
`leaderboard-snapshots.js` real guards, and gave `seen-repos.js` only the atomic
write — so a fresh or re-provisioned host still silently replaces the whole
dedup ledger with a today-only file and commits it. `CLAUDE.md:284` documents
the guard as present for all three. A test at `tests/seen-repos.test.js:61`
pins the unguarded fallback as correct, which is why a green suite never caught
it.

The five Mediums are all "succeeded, but not really": a non-critical curator
whose output its own validator rejected still reports `ok`; the daily Telegram
success notice omits every stage status, so a degraded faithfulness guard ships
silently; the `collect` entry in the run state is structurally constant across
all 63 recorded runs, so a degraded collect is invisible; and the two
discoveries changes that merged today interact so that any repo mentioned once
in a feed bypasses the velocity gate outright — including via a substring match
that validates the wrong repo.

## Cross-cutting themes

### 1. Fix sweeps that stopped one file short

Three separate commits each named a *class* of files and then converted all but
one member. This is the single highest-yield pattern in this review:

| Sweep | Converted | Missed |
|---|---|---|
| `6045a17` "the three persistent ledgers" | `star-history.js`, `leaderboard-snapshots.js` | **`seen-repos.js`** (led-1, **H**) |
| `5fc6e42` "token off curl argv" | `archive-month.sh`, `hydrate-archive.sh` | **`production-run.js:290`** (sec-1) |
| fs-atomic conversion (same commit) | 4 ledger/quota writers | **`snapshot.js:64`** (col-1) |

In each case the commit body states the general rule correctly and the diff
applies it partially. Worth a grep-the-class step before closing such a PR, not
just three point fixes.

### 2. A successful run and a correct run are not the same thing, and only one is reported

Three independent gaps stack:

- `renderSuccess` (`production-run.js:135`) renders no stage status at all,
  while `renderFailure` (`:98`) renders all of it (ops-1).
- `summarizeStages().degraded` is computed (`stage-results.js:102`) and consumed
  by nobody (ops-1).
- `stages.collect` is `skipped` in **63 of 63** recorded runs — successes,
  failures, and the outage days alike (ops-2).

`faithfulness` is the only `optional` stage, so it is the only one that can
degrade without failing the run; when it does, the report publishes with the
anti-hallucination guard skipped and the owner is told "completed successfully".
`metadata.degraded` does reach the *report* (`report-meta.js:43` →
`meta.degraded_sources`) but never the run state or the notice.

### 3. Two criticality models disagree

`stages.js:36,46,61` declare all four curators `criticality: 'required'`.
`curate.sh:61` still carries `CRITICAL=(discoveries pulse)` from the era when
the script ran all four in one invocation. `CLAUDE.md:18` documents the
`curate.sh` model. Under the sequencer's per-section invocation the
disagreement becomes a real hole (cur-1).

### 4. Drift is concentrated in the files read first

`CONTRIBUTING.md` and `.claude/rules/node-source.md` still describe the
pre-2026-05 layout (`.claude/lenses/`, `config.json` sources, `src/fetchers/all.js`).
These are exactly the files a new contributor and a fresh Claude Code session
read before touching anything. One `CONTRIBUTING.md` instruction now *aborts the
pipeline* if followed (doc-1).

---

## Findings

### led-1 · **H** · dim 3 · `[tested]`

`src/lib/seen-repos.js:40-48` — `loadSeenLedger`'s data-branch fallback is a
bare `catch { return []; }`. When the local ledger is absent or corrupt **and**
`git show refs/remotes/origin/data:data/seen-repos.json` fails (missing ref on a
fresh or re-provisioned host, or any other git error), the function reports an
empty ledger. `appendSeen` (`:74-89`) then loads that same empty ledger, appends
today's picks, and writes the file; `scripts/run.sh:43` commits
`data/seen-repos.json` to the `data` branch every run.

**Failure scenario:** production host re-provisioned (or `data/` cleared)
without `git fetch origin data` — the exact scenario `CLAUDE.md:284` documents.
Stage 1 sees an empty seen-set, so every previously-shown repo re-enters the
candidate pool; Stage 4 appends the day's picks to an empty ledger and pushes it.
The accumulated cross-day dedup history is replaced by a single day's entries.
The 新發現 tab then re-surfaces repos it already published, and nothing logs a
warning.

Reproduced: `loadSeenLedger(<absent path>) -> []`, then
`appendSeen([{repo:'today/pick',stars:10}], '2026-08-07')` → file holds exactly
one entry. The same input to `star-history.recordSnapshot` returns
`{recorded:0, repos:0, skipped:true}` and refuses to write — the guard
`seen-repos.js` never got.

Three things travel with this fix:

- `CLAUDE.md:284` claims all three ledgers "refuse to start from scratch when the
  branch state is unknowable". Two do.
- `tests/seen-repos.test.js:61` — `it('falls back (returns []) when the local
  ledger is corrupt JSON')` asserts the defect *is* the contract. Its temp
  ledger path is also absent from the data branch, so the test's real assertion
  is "corrupt local + unreachable branch → `[]`" — the precise wipe
  precondition, pinned green. Compare `tests/star-history.test.js:87,95`
  (`refuses to overwrite a corrupt local ledger`, `refuses a fresh write when
  the data-branch ref is unavailable`). This is why the miss survived #127.
- `tests/seen-repos.test.js:3` claims tests "never … invoke git". The git
  fallback *is* invoked on every absent-file case; it just fails.

**Fix direction:** port `star-history.js`'s provenance model — distinguish
`absent` (no ledger anywhere → cold start, write proceeds) from `unavailable`
(prior state exists or may exist but could not be read → refuse + actionable
error), with the branch reader injected so tests stay hermetic. Replace the
`:61` test with the two star-history-shaped ones.

### cur-1 · **M** · dim 1 · `[tested]`

`scripts/curate.sh:61,228-236` — when the sequencer invokes one section
(`stages.js:39`: `['bash','scripts/curate.sh', s]`), the exit-code decision
still runs against `CRITICAL=(discoveries pulse)`. For `market` and `tech` the
`FAILED` set never intersects `CRITICAL`, so the script exits **0** on a total
failure.

Verified with a stub `claude` on `PATH` that always exits 1:

```
bash scripts/curate.sh market  → exit 0   ("non-critical section 'market' failed — UI will show degraded")
bash scripts/curate.sh pulse   → exit 1   ("critical section 'pulse' failed — aborting")
```

The exit code therefore carries no signal for two of the four stages; the only
remaining protection is `satisfied()`'s `fresh-outputs` check. That check
catches a *missing* or *unparseable* output — but not the failure class the
repair ladder actually leaves behind. `run_curator` returns 2 when validation
fails **after** the LLM repair, and in that path `curated/market.json` exists,
parses, and has a fresh mtime.

**Failure scenario:** the market curator emits syntactically valid JSON whose
shape violates `MarketCuratedSchema` (missing item fields — the residue after
`jsonrepair` fixes syntax but not schema). `curate.sh` exits 0; `satisfied(
'curate.market')` returns `{satisfied:true, reason:'ok'}`; `curateItemCount`
returns 1 so it is not even `suspicious-empty`; `classify()` returns **`ok`**.
Merge then consumes an output that Stage 2's own validator rejected.

Reproduced: `MarketCuratedSchema.safeParse({ma:[{nope:1}],funding:[],taiwan:[]})`
→ rejected, while `satisfied('curate.market')` → `{satisfied:true,reason:'ok'}`.

**Fix direction:** make the per-section invocation propagate `run_curator`'s
return code (the batch-mode `CRITICAL` logic only applies when no section
argument was given), and let `stages.js` remain the single source of
criticality. Optionally have `run_curator` remove `$out_file` when validation
fails after repair, so `fresh-outputs` also fails closed.

### ops-1 · **M** · dim 1 · `[tested]`

`src/ops/production-run.js:135-158` — `renderSuccess` emits report date, run
ids, duration, recovery counters, and missing days, but **no stage status**.
`renderFailure:98-133` ends with `renderStages(latest.stages)`. Meanwhile
`summarizeStages()` computes a `degraded` list (`stage-results.js:102,109`) that
`production-run.js` never reads — only `attempted`/`retried`/`rerolled` are
copied into the state.

**Failure scenario:** `check-faithfulness.sh`'s apply step fails (its
`|| { … exit 0 }` guard at the tail is deliberate never-abort), so
`editorial.faithfulness` is never set. `satisfied('faithfulness')` returns
`unaudited`; `faithfulness` is the one `optional` stage (`stages.js:71`), so
`classify` returns `degraded`, not `failed`; `runPipeline.ok` stays true; merge
proceeds; the report publishes with the hallucination guard skipped. The owner's
only daily signal reads:

```
[ai-daily-report production] completed successfully
report_date: 2026-08-07
duration: 10 min
report: https://bolin8017.github.io/ai-daily-report/
```

Reproduced against a synthetic sequencer log: `summary.degraded ===
['faithfulness']`, `renderSuccess` mentions it `false`, `renderFailure` mentions
it `true`.

**Fix direction:** render a `degraded:` line in `renderSuccess` whenever
`summary.degraded` is non-empty (and store `degraded` in the run state alongside
`recovery`), or simply append `renderStages` to the success notice when anything
is not `ok`/`skipped`.

### ops-2 · **M** · dim 1 · `[tested]`

`scripts/run.sh:118-119` runs `node src/collect.js` unconditionally, then hands
off to the sequencer, which finds `collect` already satisfied
(`satisfied.js:44-54` — `metadata.json` carries today's date) and emits
`skipped` (`run.js:195`). The state file therefore records
`{status:'skipped', cost_usd:0, tokens:0, error:null}` for `collect` on **every**
run, whatever collect did.

Confirmed across all 63 recorded production runs in
`~/Documents/Hermes/ai-daily-report/cron-production/runs/` — including
`final_rc=1` days (2026-07-31 → 08-02) and `final_rc=22` (07-20): zero runs
where `stages.collect.status !== 'skipped'`.

**Failure scenario:** Miniflux is down. `collect.js:165-167` logs
`miniflux feed pull FAILED (feed half degraded)` and pushes `miniflux-feeds`
into `metadata.degraded`, so the ~37-feed native-RSS half — the input behind
脈動, 市場 and the excellence funnel's external validation — is absent for the
day. `metadata.degraded` reaches the report
(`report-meta.js:43` → `meta.degraded_sources`) but never the run state and
never the notice. The run reports `succeeded` with `· collect: skipped` and no
other trace.

**Fix direction:** have `cmdRun` read `data/staging/metadata.json` after
`run.sh` returns and fold `sources` health + `degraded` into
`base.stages.collect` (or a sibling `base.collect` block), then surface a
non-empty `degraded` list in both notices. Pairs naturally with ops-1.

### disc-1 · **M** · dim 1 · `[tested]`

`src/lib/excellence.js:291-301` — `externalValidation` tests
`hay.includes('github.com/' + repoFullName)` with no trailing boundary, so any
repo whose full name is a **prefix** of a mentioned repo is counted as
externally validated.

Since `decbf89` (merged today) moved `if (hasValidation) return 'pass'` above
the `historyDays < 4` check, a single validation ref is now an unconditional
velocity-gate pass — ahead of the cold-start check, the spike filter, and the
`perDay`/`totalStars` thresholds alike.

**Failure scenario:** an HN item links `github.com/openai/gpt-oss`. The
unrelated repo `openai/gpt`, sitting in the candidate pool with `spike=true`
and `perDay=0`, is credited with that validation and passes the gate, then
collects up to 0.18 of the composite score for a mention that was never about
it. Reproduced: `externalValidation('openai/gpt', [hn:…/openai/gpt-oss])` →
`['hackernews']`; `velocityGatePass({historyDays:20,perDay:0,totalStars:40,
spike:true}, {hasValidation:true})` → `'pass'`.

**Fix direction:** require a boundary after the repo name — match
`github.com/<owner>/<repo>` followed by end-of-string or one of `/ ) ] " ' <
whitespace . , ;` — or reuse `feed-github-repos.js`'s `REPO_URL_RE` capture and
compare the extracted `owner/repo` for equality instead of substring-testing.

### disc-2 · **M** · dim 2 · `[tested]`

`src/lib/feed-github-repos.js:11-13` states that items produced by the new feed
harvest carry the search provider's shape "so every existing gate (freeGates
age/license/staleness, velocity, engineering) applies unchanged — this widens
the intake, it does not relax the bar."

The velocity gate does **not** apply. A `github-feed` candidate exists precisely
because `extractRepoMentions` found its URL in a feed item, and
`externalValidation` scans that same `raw.feeds.items` for that same URL — so
`hasValidation` is true by construction for every harvested repo, and
`velocityGatePass` returns `'pass'` before evaluating anything else. The same
mention also contributes 0.09–0.18 of the composite score.

Reproduced: one HN item linking `github.com/acme/spike-tool` yields the mention,
and `velocityGatePass({historyDays:20,perDay:0.1,totalStars:12,spike:true})`
returns `'pass'` with validation where the identical stats return `'fail'`
without it.

Whether the relaxation is wanted is a product call — the PR body's stated intent
("the funnel never saw the repos people were actually reading about") arguably
implies it. What is not defensible is a comment asserting a contract the code
does not honor, on a path that has **never run in production**: PR #167 merged
at 22:26 on 2026-08-07, after that morning's 08:30 run. The first real exercise
is the 2026-08-08 run.

**Fix direction:** decide explicitly. Either exclude a repo's own harvest source
from its `externalValidation` set (so a feed-sourced repo still has to earn
velocity or a *second*, independent mention), or keep the behavior and correct
the comment to say the velocity gate is intentionally waived for this intake.
Either way, note that disc-1's boundary fix lands in the same function.

### sec-1 · **L** · dim 7 · `security`

`src/ops/production-run.js:290` passes `Authorization: Bearer ${token}` as a
curl **argv** element, world-readable in `/proc/<pid>/cmdline` for the life of
each dispatch. `5fc6e42` removed exactly this pattern from `archive-month.sh`
and `hydrate-archive.sh` ("world-readable in /proc/<pid>/cmdline during each
call — contradicting commit.js's deliberate token hygiene") and both now use a
0600 header file via `-H @file`; `production-run.js` predates that commit
(introduced in #86) and was not swept. The comment at `:273-274` justifies the
current form with the wrong property — "spawnSync does not echo argv to the log"
is true and irrelevant to argv visibility.

Single-owner host, so exposure is bounded — but this is the last remaining site
of a pattern the repo already decided against.

**Fix direction:** write the header to a 0600 temp file (mirror
`archive-month.sh:98-99`) and pass `-H @file`; unlink in a `finally`.

### doc-1 · **L** · dim 2

`CONTRIBUTING.md` — four instructions that no longer work, in the repo's
contributor entry point:

- `:27`, `:33`, `:53` — `.claude/lenses/ai-builder.md` and
  `.claude/daily-report-quality.md`; both moved to
  `themes/ai-builder/{synthesizer,quality}.md` in the 2026-05-24 theme cutover.
  Neither path exists.
- `:50` — "Add an entry to `config.json` under `sources.feeds[]`". `config.json`
  is `{}` and `ConfigSchema` is `z.object({}).strict()` since `0188f9c`.
  Verified: writing that key and importing `src/lib/config.js` aborts at startup
  with a Zod `unrecognized_keys` error, so following this instruction breaks the
  pipeline for every stage. The source list lives in
  `themes/<theme>/sources.yaml`.
- `:51` — `node src/fetchers/feeds.js`; that file does not exist (providers moved
  under `src/fetchers/providers/`).

### doc-2 · **L** · dim 2

`.claude/rules/node-source.md` — auto-loaded into every Claude Code session
working on `src/`, and three of its statements are stale:

- `:30` — "register it in `src/fetchers/all.js` (the parallel runner)". The
  runner is `src/fetchers/run-all.js`; registration is via
  `src/fetchers/providers/_registry.js` plus a side-effect import in
  `src/collect.js`. `src/fetchers/all.js` does not exist.
- `:40` — "`runFetchers()` tolerates 1 of 4 fetchers failing (MIN_HEALTHY = 3)".
  Neither symbol exists; `runAll` takes `minHealthy: Math.ceil(sources.length/3)`
  over ~22 sources (`collect.js:147-150`).
- `:46` — "Update the agent prompt (`.claude/lenses/ai-builder.md`)". Same dead
  path as doc-1.

### doc-3 · **L** · dim 2

- `CLAUDE.md:50` — the How-to-Run table lists `node src/fetchers/feeds.js` as the
  single-fetcher example; the file does not exist.
- `CLAUDE.md:289` — describes 市場 as `ma / funding / policy / taiwan`. There is
  no `policy` sub-group anywhere: `MarketCuratedSchema` (`curated.js:25`), the
  theme `sectionSchema`, `manifest.yaml`, `curator.md` and `partial.njk` all
  agree on three. `section-market.njk:1` even documents the removal. A `policy`
  key emitted by a curator would fail Stage 2 validation.
- `docs/data-sources.md:15` — same dead `src/fetchers/feeds.js` path in the
  source table.

`CLAUDE.md:284`'s false ledger-guard claim is covered by led-1's fix.

### doc-4 · **L** · dim 2

Three surviving `07:00 Asia/Taipei` claims after `b1a9389` corrected the
schedule to 08:30 — `scripts/run.sh:4`, `docs/data-sources.md:261`,
`.github/workflows/deploy.yml:75`. Today's run started `00:30:32Z` = 08:30
Taipei, matching `CLAUDE.md`, `README.md` and `docs/architecture.md`.

### doc-5 · **L** · dim 2

Two more `src/fetchers/all.js` references outside the rules file:
`docs/data-sources.md:262` (which also describes the retired "4 fetchers,
tolerate 1 failure" model) and the comment at `src/fetchers/_dispatch.js:3`.

### ops-3 · **L** · dim 1

`scripts/merge-report.sh` carries two dead paths:

- `:15` documents exit code `3 — dangling source_link`, and `:120-122` catches
  `/dangling source_link/` to exit 3. `composeReport` stopped throwing on
  dangling links in the 2026-06-04 cure-don't-abort change
  (`merge.js:319-323` drops and warns). The branch is unreachable and the
  documented exit code cannot occur.
- `:100` reads `process.env.ANALYZE_DURATION_MS`, which nothing in the repo ever
  sets — the only occurrence is this read. `meta.analyze_duration_ms` is
  therefore permanently absent.

### col-1 · **L** · dim 3

`src/lib/snapshot.js:64` writes `data/feeds-snapshot.json` with a plain
`writeFileSync`. It is the only *committed* data artifact still not routed
through `atomicWriteFileSync` — `seen-repos`, `star-history`,
`leaderboard-snapshots` and `quota` all were, and `fs-atomic.js` already exists.

Bounded in practice: a crash mid-write kills `collect.js`, `run.sh`'s `set -e`
aborts before `commit_outputs`, and the next run overwrites the file. But the
consumer fails hard — `eleventy.config.js:291` *throws* on an unparseable
snapshot, failing the 11ty build and therefore the deploy — so the one-line
conversion is worth taking.

### dep-1 · **L** · dim 6

`npm audit --omit=dev` reports 2 vulnerabilities (1 high, 1 moderate), and
nothing in CI looks at it:

- `undici@7.24.7` (high) — transitive via `cheerio@1.2.0`. **Not reachable
  here**: cheerio is used only as `cheerio.load(<string>)` in
  `github-trending-html.js:38` and `github-developers-html.js:20`; no
  `fromURL`/network path, and nothing imports undici directly. Node's own fetch
  uses its bundled copy, not this one.
- `postcss@8.5.20` (moderate, arbitrary `.map` read via `sourceMappingURL` when
  `from` is unset) — production path via `sanitize-html@2.17.6`. Reached only
  when style attributes are parsed; `SANITIZE_OPTS`
  (`eleventy.config.js:95-102`) sets no `allowedStyles` and `style` is not in
  the allowed attributes, so the parser is not invoked on report content.

Both have `fixAvailable: true`. The finding is not "we are exploitable" — it is
that a permanently-red `npm audit` with no CI gate is an unmonitored signal, and
these two are cheap to clear.

## Dimensions with nothing found

- **dim 4 (cross-platform / multi-engine parity):** production, CI and the
  scripts are uniformly Linux (`/proc` in `watchdog.sh`, GNU `date -d` in
  `archive-month.sh`) and nothing claims otherwise. `.nvmrc` (22),
  `package.json engines` (`>=22.0.0`) and `deploy.yml` (`node-version: '22'`)
  agree. Legacy v1.x / v2.0 / v2.1 reports all still render — the
  `schema_version` dispatch in `report-body.njk` and the
  `report.discoveries ? … : catalog+shipped` branch in `unified.njk` were
  re-checked against the 83 locally hydrated reports (2 × v2, 61 × v2.1,
  19 × v1.x). Clean.
- **dim 5 (test quality):** 612 tests, no tautological assertions, no
  `it.todo`/`describe.skip`; the three `it.skipIf` uses are legitimate
  environment guards. Only `fs-atomic.js` and `validate.js` lack a dedicated
  test file, both thin and exercised indirectly. The one genuine defect in this
  dimension — `tests/seen-repos.test.js:61` pinning the wipe behavior as
  correct — is folded into led-1, since the same PR must replace it.
- **dim 7 (security), beyond sec-1 and dep-1:** no tracked secrets
  (`docker/aggregator/.env` is untracked and never appears in `git log --all`);
  CSP present and restrictive (`base.njk:6`, `script-src 'self'`,
  `object-src 'none'`); LLM HTML sanitized at data-load time and `scrubUrls`
  drops non-http(s) `*url` fields; the v2 partials use `| safe` only on
  `report.lead.html`, so curated item text is Nunjucks-autoescaped; the five
  embedded `node -e` programs all read inputs from `process.env` after
  `5fc6e42`; git/child-process calls use `execFileSync`/`spawn` with argv
  arrays. No injection or XSS finding survived verification.

## Notes without a batch

- **Behavioral enrichment is rank-capped, by design.** `build-discoveries.js:185`
  enriches only the top 25 by the pre-behavioral score, and every behavioral term
  is non-negative — so a candidate at rank 26 with strong commit continuity can
  never overtake rank 25. The `BEHAVIORAL_TOP_N` comment states the budget
  tradeoff; recording it here only so it is a known property rather than a
  surprise.
- **`REPORT_FILE` in `scripts/synthesize.sh:30`** is assigned and never read.
- **First-exercise watch:** #164/#165/#167 (faithfulness prompt clearing,
  validation-first gating, feed harvest) merged after today's run. The
  2026-08-08 run is their first production exercise; the feed harvest adds up to
  ~80 GitHub-core calls/day (40 mentions × 2), which is worth confirming against
  the quota ledger on that run.

---

## Roadmap

One batch = one concern = one PR, severity first. All are independent except
where noted. Sizes are rough changed-line estimates.

| # | Batch (proposed PR) | Findings | Size |
|---|---|---|---|
| 1 | `fix(seen-repos): refuse to reset the dedup ledger when prior state is unknowable` | led-1 (+ `CLAUDE.md:284`, + replace the test that pins the defect) | ~90 |
| 2 | `fix(curate): propagate a non-critical section failure to the sequencer` | cur-1 | ~60 |
| 3 | `fix(ops): surface collect health and degraded stages in state + success notice` | ops-1, ops-2 | ~90 |
| 4 | `fix(excellence): anchor externalValidation at a repo-name boundary` | disc-1 | ~40 |
| 5 | `fix(discoveries): stop feed-harvested repos from self-validating past the velocity gate` | disc-2 | ~50 |
| 6 | `docs: repair contributor- and agent-facing drift` | doc-1, doc-2, doc-3, doc-4, doc-5 | ~70 |
| 7 | `chore(hardening): move the Pages-dispatch token off curl argv` | sec-1 | ~25 |
| 8 | `chore(merge): drop the dead dangling-link exit path and the unset duration knob` | ops-3 | ~20 |
| 9 | `fix(snapshot): write feeds-snapshot.json atomically` | col-1 | ~10 |
| 10 | `chore(deps): clear the two npm advisories; decide whether CI gates audit` | dep-1 | ~15 |

Batches 4 and 5 both edit `excellence.js` / the validation path; taking 4 first
avoids a textual conflict, though the concerns are separable. Batch 5 needs a
product decision (waive the velocity gate for feed-sourced repos, or require an
independent second mention) before it can be written — see disc-2.
