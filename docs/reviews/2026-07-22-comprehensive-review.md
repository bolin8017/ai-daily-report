# Comprehensive repo review — 2026-07-22 (delta)

One day after the [2026-07-21 comprehensive review](./2026-07-21-comprehensive-review.md)
and [operational reliability review](./2026-07-21-operational-reliability-review.md),
whose 21 roadmap batches all merged (PRs #126–#141, #143–#149). This review is
therefore a **delta pass**, not a re-audit: (a) an adversarial review of the
still-unreviewed fix diff `b227a25..HEAD` (PRs #143–#149), (b) the areas the
prior reviews did not deeply cover (auxiliary scripts, low-coverage lib
modules, dependency hygiene), (c) fresh production evidence from the first run
executed on the fixed code (2026-07-22), and (d) closure checks on the prior
reviews' open watch items.

Severity: **H** = user-visible breakage or data loss on realistic input ·
**M** = silent misbehavior / broken contract · **L** = edge case or hygiene.
`[tested]` = reproduced empirically or observed in production evidence.

Baseline at review time: `npm test` 585 passed / 0 failed (88 files),
`npm run lint` clean (215 files), `npm run check:sources` in sync (10/10).

## Headline

**No High or Medium findings.** The 2026-07-22 production run — the first on
the fully fixed code — succeeded end-to-end with zero retries (~14.7 min,
~$2.38 LLM spend), the market tab shipped 14 items (the ops-4 empty-tab
pattern did not recur), and the new missing-day detection correctly surfaced
the five historical holes (07-08 → 07-12). Everything found today is **L**:
documentation drift, one dead script, non-atomic writes on two low-stakes
files, and bounded retry-accounting edges in the new recovery code.

## Watch items from 2026-07-21 — closed

- **agg-1 (RSSHub binding)** — verified on the production host 2026-07-22:
  `ss -ltn` shows RSSHub (1200), Miniflux (8080), Postgres (5432) all bound to
  `127.0.0.1` only; `docker-compose.yml:21-23` already pins the verification
  note. Closed. `[tested]`
- **diff-2 (star-history provenance)** — `refs/remotes/origin/data` resolves;
  the 07-22 log shows `recordSnapshot` ran ("star-history: recorded 282 repos
  (961 tracked)"). Ledgers accruing normally. Closed. `[tested]`

## Production evidence (2026-07-22 run) `[tested]`

- Run succeeded, `rc.final=0`, no recovery attempted. Report published to
  `origin/data` and deployed (dispatch succeeded first try).
- New code paths: missing-day detection **fired** (5 historical holes listed
  in the notice); the JSON-repair ladder, suspicious-empty re-roll, quarantine
  dir, and dispatch retry were all **not needed** (clean first-pass run) —
  their first production exercise is still pending.
- Timing/cost profile: collect ~83 s ($0) · curate 4-way parallel ~119 s
  wall ($0.92) · synthesize **676 s** ($1.46, 35,331 output-side tokens) ·
  context/faithfulness/merge < 1 s each. Synthesize is the structural
  long pole (~77 % of wall-clock, ~61 % of spend).
- The deterministic faithfulness repair fired (1 temporal marker fixed, no
  LLM judge needed) — working as designed.
- No new failure signatures vs the 07-21 review; recurring known noise only
  (`sk-hynix-news` tier exhaustion, 2× fail-soft README 404s).

## Adversarial review of `b227a25..HEAD` (PRs #143–#149)

The diff is solid: no High/Medium defects, no incomplete fixes, no
regressions. Verified clean (each traced in full, tests inspected for
honesty): the repair ladder triggers jsonrepair before any abort on the exact
production failure class, and the error-feedback LLM repair runs before a
critical section exits non-zero; `CURATE_FALLBACK_MODEL` drives both the API
fallback and the repair model; report-gaps date math has no
REPORT_TIMEZONE-vs-UTC drift; the published-but-undeployed state is correctly
distinguished; the re-roll cannot loop (per-run `emptyRetried` set); no
ledger double-append on any retry path; new tests inject only curl/sleep,
not the logic under test. Surviving edges:

### dr-1 · **L** · dim 1
`src/pipeline/run.js:261-266` (re-roll, guarded by `emptyRetried`) +
`:282-303` (recovery pass, targets `failed` retryable stages) — the two retry
budgets are independent. **Failure scenario:** a critical curate stage goes
empty → re-roll → the re-roll *hard-fails* (rc≠0) → `classify` returns
`failed` → the recovery pass retries it again = **3 invocations** (each
possibly spending a Sonnet repair call), exceeding the documented "at most
one retry" model. Bounded, non-looping; only reachable for discoveries/pulse
(market/tech mask section failure to exit 0). The empty→hard-fail combination
is untested. **Fix:** let the `emptyRetried` entry also suppress the recovery
retry for that stage, or document that the budgets stack.

### dr-2 · **L** · dim 1
`src/ops/production-run.js:255-262` — `remoteDataListing` returns `''` on
git fetch/ls-tree failure, and the gap scan (`:412-416`) runs on it
unconditionally: `parseReportDates('') → []` → **all 14 lookback days
reported missing**. The run fails anyway on the remote-present check, but the
notice carries a spurious 14-day gap list that misdirects diagnosis.
**Fix:** skip the scan (`missing_days: null`) when the listing is empty and
today's own report was not found.

### dr-3 · **L** · dim 1
`src/ops/production-run.js:270,301-318` — `curl -fsS` exits 22 on any
HTTP ≥ 400, so the dispatch retry cannot distinguish a permanent 401/404
from the transient 503 it targets: a bad token burns 3 attempts + ~60 s of
synchronous sleep before failing. Bounded waste, not wrongness.
**Fix:** capture `%{http_code}` and stop on 4xx (or accept the bounded cost).

### dr-4 · **L** · dim 3
`scripts/curate.sh:168-196` — in the LLM-repair path the repair model
overwrites `$out_file` *before* the post-repair `quarantine_artifacts` call,
so on repair failure the quarantined `<section>.json` is the
repaired-but-still-broken file, not the curator's original — the artifact
ops-5 exists to post-mortem. Mitigated: the raw envelope (`$section.raw.json`)
is also quarantined, so the original is recoverable, just not where the
quarantine comment implies. **Fix:** snapshot the original `$out_file` before
invoking the repair model.

### dr-5 · **L** · dim 1 · `[tested]`
`src/curators/validate-output.js:24-33` — a jsonrepair success is treated as
fully clean. Reproduced: a mid-array truncation repairs to only the surviving
items (20 → 6), passes schema, and proceeds; the sole backstop is the exact
`items=0` quarantine gate, so a *partial* loss ships silently. A deliberate,
defensible tradeoff (better than aborting the day) — recorded so the choice
is on the record. **Fix (optional):** log/quarantine when the repaired item
count is implausibly low vs the staging slice.

### dr-6 · **info**
`src/ops/stage-results.js:74-82` — retry accounting only tracks retries
triggered by a `failed` record; an empty→re-roll→ok stage shows no retry
marker in the notice (cost double-count is correct). Observability gap only.

### dr-7 · **info**
`src/curators/validate-output.js:44` — in-place non-atomic rewrite of a
staging file. Matches the prior inline behavior it replaced; staging is
ephemeral. Note only.

## Previously uncovered areas

Auxiliary scripts, low-coverage lib modules (claude-envelope, faithfulness,
repair-editorial, report-confidence, report-lint, interests, section-condense,
section-map, source-dates, telemetry, fs-atomic), and dependency hygiene were
swept; all clean except:

### unc-1 · **L** · dim 2
`CLAUDE.md` ("GitHub topic search" bullet) claims topics come from
`themes/<theme>/sources.yaml → github_topics` with a `tier.core`/`tier.rotating`
structure. Reality: `src/fetchers/providers/github-search-api.js:10-13` reads
`themes/<theme>/interests.yaml` via `src/lib/interests.js`
(`level: core|rotating|off` + `rotation.rotating_per_day`); the only
`github_topics` in sources.yaml is the `phison_overlay` flat list consumed
solely by `src/lib/scope.js` for scope-tagging. **Failure scenario:** a dev
edits sources.yaml per CLAUDE.md to change search topics; nothing changes.
`docs/data-sources.md` is already correct; only CLAUDE.md drifted (and
`check:sources` does not guard CLAUDE.md). **Fix:** correct the bullet.

### unc-2 · **L** · dim 2
`scripts/shadow-diff.sh` — zero callers (grep clean), and its comparison
logic targets the retired v2.0 shape (`schema_version === 2` strict,
`ideation`/`shipped.trending`); every current 2.1 report falls into its
"legacy v1.x" branch and prints zeros. A dead migration-era tool (last
meaningful at the 2026-05-22 cutover). **Fix:** delete (flagged here per
review discipline; removal is a roadmap decision).

### unc-3 · **L** · dim 3
`src/lib/quota.js:49-55` — `record()` is an async read-modify-write of
`data/quota.json` via plain `writeFile`: concurrent chain fallbacks
(`Promise.allSettled` in `run-all.js`) can interleave and lose increments,
and a crash mid-write corrupts the file, after which `readLocal` swallows the
parse error → `{}` → the month counter silently resets. Same class as the
fixed ledger findings (merge-5/collect-2) but quota.json was not among the
files converted to `fs-atomic.js`. Bounded: with `FIRECRAWL_API_KEY` set,
`canSpend` prefers the API's own remaining-credits. **Fix:** route through
`atomicWriteFileSync`; optionally distinguish absent-vs-unparseable.

### unc-4 · **L** · dim 1
`scripts/miniflux-sync.mjs:88-95` — per-feed provisioning failures are
collected and logged but `main()` returns normally → **exit 0 on partial
failure**; `node scripts/miniflux-sync.mjs && …` chains proceed as if fully
provisioned. Operator-run with visible output, hence L.
**Fix:** `process.exit(failures.length ? 1 : 0)`.

### unc-5 · **L** · dim 2 (carried from site-4, code side)
`eleventy.config.js:49-55` still registers `uiStrings`/`theme` globals that
zero templates read; v2 tab labels and the site title remain hardcoded.
The doc side was fixed on 07-21 (CLAUDE.md now scopes the theme-swap claim);
the render-layer wiring remains deliberately deferred. Becomes relevant only
if a second theme is ever activated.

### Minor note (no batch)
`CURATE_FALLBACK_MODEL`, `FAITHFULNESS_MODEL`, `FAITHFULNESS_FALLBACK_MODEL`,
`FAITHFULNESS_TEMPORAL_TOLERANCE_DAYS`, and `WATCHDOG_*` are read by code but
absent from `.env.example`, which CLAUDE.md frames as listing "all
variables." Each has a sane default and a script-header doc. Fold into the
docs batch.

## Dimensions with nothing found

- **dim 4 (parity):** legacy render paths unchanged since 07-21; clean.
- **dim 5 (test quality):** the 74 new tests in the fix diff pin real
  behavior (real jsonrepair, real Zod schemas; only curl/sleep injected);
  no tautological tests found in the swept modules.
- **dim 6 (CI):** unchanged since the 07-21 fixes (themes/** trigger +
  check:sources in build); clean.
- **dim 7 (security):** no new findings; agg-1 closed by host verification;
  dependency sweep found no unused packages (all 8 imported), engines
  constraint matches CI.

## Forward-looking optimization directions (beyond defect findings)

Not defects — recorded because "where can this project still improve" was
the review's driving question, and the defect list above is thin:

1. **Latency/cost long pole is Stage 3 synthesize** (676 s, $1.46 of the
   $2.38/run): the single biggest lever for wall-clock or spend is trimming
   the synthesizer's input context (curated + raw staging + report-context)
   or its output volume — not the fetchers or curators, which are already
   parallel and cheap. Only worth touching if the ~15-min runtime or ~$72/mo
   spend starts to matter; the pipeline has no hard deadline pressure today.
2. **First-exercise watch:** the repair ladder / re-roll / dispatch-retry
   paths merged last night and have not yet fired in production. The next
   curator-failure day is their real test; the quarantine dir will hold the
   evidence either way.
3. **Theme render-layer wiring (unc-5)** unlocks the documented
   single-directory theme swap end-to-end — worth doing only when a second
   theme becomes real.

---

## Roadmap

All findings are L; batches ordered by operational value, one batch = one
concern = one PR; all independent. Sizes are rough changed-line estimates.

| # | Batch (proposed PR) | Findings | Size |
|---|---|---|---|
| 1 | `fix(ops): guard gap scan against failed git listing; stop dispatch retry on 4xx` | dr-2, dr-3 | ~50 |
| 2 | `fix(curate): quarantine the original output before LLM repair` | dr-4 | ~20 |
| 3 | `fix(pipeline): empty re-roll suppresses recovery retry; mark re-rolls in accounting` | dr-1, dr-6 | ~50 |
| 4 | `fix(quota): atomic quota.json writes` | unc-3 | ~40 |
| 5 | `docs: correct topic-search source in CLAUDE.md; add missing env vars to .env.example` | unc-1, env note | ~30 |
| 6 | `chore: delete dead scripts/shadow-diff.sh` | unc-2 | ~-60 |
| 7 | `fix(miniflux-sync): non-zero exit on partial provisioning failure` | unc-4 | ~5 |
| 8 | *(deferred until a second theme exists)* `feat(site): wire theme ui-strings into templates` | unc-5 | ~80 |

dr-5 and dr-7 are recorded without a batch (deliberate tradeoff / ephemeral
staging); revisit dr-5 only if a partial-loss day is observed in quarantine.
