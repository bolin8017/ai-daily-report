# Comprehensive repo review — 2026-07-21

Mode: deep report (all subsystems, dimensions 1–7). Every finding below was
re-verified by re-reading the cited lines; findings marked `[tested]` were
additionally reproduced empirically in a sandbox (never against live data).
Severity: **H** = user-visible breakage or data loss on realistic input ·
**M** = silent misbehavior / broken contract · **L** = edge case or hygiene.
`security`-tagged findings sort first within their band.

Baseline at review time: `npm test` 528 passed / 0 failed (82 files),
`npm run lint` clean (205 files), `npm run check:sources` in sync.

## Cross-cutting themes

1. **Persistent ledgers trust their own readability.** Three independent
   cross-day state files (leaderboard snapshots, star history, seen-repos)
   share the same pattern: *load → fall back to `{}` on any read/parse
   failure → unconditionally write back*. A corrupt or absent file therefore
   silently resets accumulated state instead of halting the write
   (arch-2 `[tested]`, arch-3, merge-5). None of the writes are atomic
   (temp+rename), so a mid-write kill is itself a corruption source.
2. **Exit codes checked at the API layer, ignored at the tool layer.** The
   archive/hydrate scripts diligently check HTTP status codes but never check
   `tar`'s exit code on either side of the round-trip (archive-1 `[tested]`,
   archive-4), and `curate.sh` masks `node -e` prompt-generation failure
   behind a trailing `printf` (pipe-2). The one `H` in this review lives here.
3. **The cure layer stops one step short of the consumer's contract.** The
   merge stage's referential-integrity cure validates that a `source_links`
   prefix *resolves*, but keeps the unresolved *form* — which the frontend
   then matches exactly, not by prefix (merge-1). Same shape as theme 2:
   each layer is locally correct, the contract between layers is the gap.
4. **Docs drifted behind three retirements.** The catalog/memory/
   FEATURE_NEW_PIPELINE removals left `.env.example` and CLAUDE.md describing
   knobs and defaults that no code reads (docs-1..4, merge-3).

What is genuinely healthy (verified, not assumed): the test suite has no
tautological or mock-the-unit tests and strong past-bug regression coverage;
`src/lib/commit.js` concurrency/token handling is sound
(`--force-with-lease`, isolated index, token never in argv or on-disk
config); the 4 parallel curators share no mutable file; app.js uses no
innerHTML with report data; every `| safe` template field maps to a
sanitized field; CI actions are SHA-pinned with least-privilege permissions;
no secrets in tracked files.

---

## Archive & cold storage (`scripts/archive-month.sh`, `scripts/hydrate-archive.sh`)

### archive-1 · **H** · dim 1/3 · `[tested]`
`scripts/archive-month.sh:157` — `tar` exit code ignored (script runs
`set -uo pipefail`, no `-e`), then `:158` computes the sha256 **over the
corrupt output**, `:186` checks only HTTP status on upload, and `:220`
deletes the month's reports from the data branch.
**Failure scenario:** disk-full/OOM/signal truncates the tarball in the
mktemp workdir → sha256 is self-consistent with the truncated file → upload
succeeds → reports removed from the branch. On hydrate, `sha256sum -c`
*passes* (it verifies the corrupt file against its own hash) and extraction
fails → reports permanently gone from both branch and Releases. Reproduced:
`tar` exiting rc=2 with a missing member still yields a tarball that passes
its own checksum, and nothing in the script observes rc.
**Fix:** check tar's rc; run `gzip -t` + `tar -tzf` and compare the member
list against `MONTH_FILES` before upload **and** before `--remove`.

### archive-2 · **M** · dim 3
`scripts/archive-month.sh:55,64-68` + `:149-152` — the monthly cron runs on
the 1st, so `CUTOFF` (today − 60d) always lands mid-month. The first run
archives only the days *before* the cutoff (e.g. run 2026-07-01 → cutoff
2026-05-02 → `archive-2026-05` contains **only May 1**), and every later run
hits `release_exists` → skip.
**Failure scenario:** ~29/30 of every boundary month is stranded on the data
branch forever; the "rolling 60-day hot window" grows without bound and the
cold archive is permanently incomplete. Not data loss (branch still serves
them), but the hot/cold contract breaks every single month.
**Fix:** gate the skip on month *completeness* (all archivable days present
in the release), or only archive months that are entirely past the cutoff.

### archive-3 · **M** · dim 1
`scripts/archive-month.sh:149-152,186-190,196-202` — if `create_release`
succeeds but an asset upload fails, the release exists empty; every rerun
then skips it via `release_exists` and exits 0 with "nothing newly
archived". The `:187` log says "rerun to retry" but a rerun cannot.
**Failure scenario:** one transient upload failure permanently un-archives
that month while the job reports success forever after.
**Fix:** make `release_exists` verify the tarball asset is present (or
delete/complete empty releases before deciding to skip).

### archive-4 · **M** · dim 6
`scripts/hydrate-archive.sh:108,114-115` — `tar -xzf` exit unchecked and the
script always `exit 0` even with `FAILED>0`.
**Failure scenario:** a persistently missing/corrupt Release asset silently
drops that month from the published site; CI stays green, no alert, and the
archive pages 404 with only a build-log line as evidence.
**Fix:** check extraction rc; emit a build warning / configurable non-zero
exit when `FAILED>0` persists.

### archive-5 · **L** · dim 7 · `security`
`scripts/archive-month.sh:89-92,109-113,130-134`, `scripts/hydrate-archive.sh:50`
— `GITHUB_TOKEN` passed as a curl `-H` argv, visible in `/proc/<pid>/cmdline`
during each call. Contradicts the deliberate token hygiene in
`src/lib/commit.js` (env-var injection, never argv). Low on a single-user
host. **Fix:** feed the header via `curl --config /dev/stdin` or `-H @-`.

### archive-6 · **L** · dim 1
`scripts/archive-month.sh:93-97` + `:149` — `release_exists` returns 2 on
transient API errors, which the `if` treats the same as 404 → attempts
create → likely 409 counted as a failure. Confusing accounting, not unsafe.
**Fix:** propagate rc=2 as retry/abort instead of "proceed to create".

### archive-7 · **L** · dim 3
`scripts/archive-month.sh:64,157,212` — the file list and tarball content
come from the **local** `data/reports/` working tree, while `--remove`
deletes from the **remote** data branch. If the local tree is stale relative
to the branch (git sync failure), the archived copy can be older than the
deleted one. Depends on the production runner's git sync holding.
**Fix:** assert local/branch consistency (compare `git show` hashes) for the
month before removal.

## Report merge & discoveries ledger (`src/lib/merge.js`, `src/lib/seen-repos.js`, `src/lib/build-discoveries.js`)

### merge-1 · **M** · dim 1
`src/lib/merge.js:147` keeps a prefix-resolved `source_links` id **verbatim**
(the docstring at `:129-130` even states it), but the DOM id is the *full*
curated id (`site/_includes/v2/item-discovery.njk:3`,
`section-signals.njk:30`) and the anchor click handler resolves by exact
`document.getElementById` with no prefix fallback (`site/assets/app.js:276,308`
— `if (!target) return;`).
**Failure scenario:** on a run where the synthesizer emits bare prefixes
(`discoveries.rising.0` without `:slug` — the documented 2026-05-28 failure
mode the cure exists for), the report composes fine but **every citation
link on the page is silently dead**: `href="#discoveries.rising.0"` never
matches element id `discoveries.rising.0:foo/bar`. Worse,
`tests/merge.test.js:261-282` asserts the bare prefix is preserved — the
suite locks the broken form in as expected behavior.
**Fix:** when a link resolves by prefix, rewrite it to the matching full
curated id from the id space; update the test to assert the rewrite.

### merge-2 · **M** · dim 1/3
`src/lib/build-discoveries.js:77` excludes any repo present in the seen
ledger regardless of `first_shown` date, and `appendSeen`
(`src/lib/seen-repos.js:66-82`, called from `scripts/merge-report.sh:97`)
has no notion of "today's entries".
**Failure scenario:** a completed day is re-run *from Stage 1* (regeneration
after a bug fix, cron double-fire, `--recover-from collect`): today's shown
repos are now in the ledger → all excluded from the candidate pool → the
rebuilt report's 新發現 rising/dev_watch come out empty or heavily depleted,
silently. (Stage-4-only re-runs are safe; `appendSeen` itself is idempotent.)
**Fix:** treat entries with `first_shown === today` as not-yet-seen during
exclusion (or exclude only `first_shown < today`).

### merge-3 · **L** · dim 2
`src/schemas/config.js` + `src/lib/config.js:19` — `config.json`'s
`providers.*` and `report.{language,max_featured_items,style}` are validated
at import but **no code reads them** (only the named `ACTIVE_THEME` /
`HOT_DAYS` / `HYDRATE_MONTHS` exports are imported anywhere; the firecrawl /
jina providers hardcode their own constants).
**Failure scenario:** an operator edits `config.json → report.language`
expecting a behavior change; nothing changes. **Fix:** drop the dead fields
from `config.json` + `ConfigSchema`, or wire consumers.

### merge-4 · **L** · dim 1
`src/lib/build-discoveries.js:77` excludes on raw `item.full_name`, while the
ledger stores `canonicalRepoKey(...)` (`scripts/merge-report.sh:95`) and the
same file canonicalizes for the history key at `:87`.
**Failure scenario:** any divergence between the two forms (trailing `.git`,
casing) misses the exclusion and re-shows a seen repo. **Fix:** exclude on
`canonicalRepoKey(item)`.

### merge-5 · **L** · dim 3
`src/lib/seen-repos.js:80` — plain `writeFileSync`, no temp+rename. A crash
mid-write corrupts the local ledger; `loadSeenLedger`'s data-branch fallback
(`:39-47`) bounds the damage to entries appended since the last commit.
**Fix:** write-temp-then-rename.

## Stage 1 collection & cross-day state (`src/collect.js`, `src/lib/*-snapshots.js`, `src/lib/star-history.js`)

### collect-1 · **M** · dim 1
`src/collect.js:70` — `mapResultsToLegacyShape` hardcodes
`out.feeds = { ok: true, ... }`; the count-based correction at `:151` runs
only when Miniflux is configured. `:298` copies this into
`metadata.sources.feeds`, which Stage 4 lifts into `report.meta.source_health`.
**Failure scenario:** Miniflux unconfigured (or its env misconfigured) + a
feed-chain outage → 0 feed items but `feeds: {ok: true, count: 0}` — the
footer renders the feed half green while it collected nothing.
**Fix:** derive `ok` from item count in `mapResultsToLegacyShape`.

### collect-2 · **M** · dim 1/3 · `[tested]`
`src/lib/leaderboard-snapshots.js:18-21,29-34` — `loadSnapshots` returns
`{}` when an **existing** file fails to parse; `saveSnapshot` is a whole-file
load-modify-write. Reproduced: over a corrupt two-board file,
`saveSnapshot('gaia', …)` writes a file containing **only** `gaia` — every
other board's baseline is destroyed. `diffSnapshots` then treats each wiped
board as cold-start, emitting spurious "ranking changed" `tech.benchmarks`
items — fabricated changes shown to readers. A truncated write (SIGKILL
mid-`writeFileSync`) or a corrupt hydrated copy triggers it. No data-branch
fallback here (unlike star-history). `tests/leaderboard-snapshots.test.js:36-39`
blesses the `{}` read and never tests the follow-on save.
**Fix:** distinguish absent (→ `{}`) from unparseable (→ throw / skip write);
temp+rename writes; add the corrupt-then-save regression test.

### collect-3 · **M** · dim 1/3
`src/lib/star-history.js:39-67,91-116` — `loadStarHistory` falls back
local → `git show refs/remotes/origin/data:…` → `{}`, and `recordSnapshot`
unconditionally writes the result.
**Failure scenario:** fresh/re-provisioned working tree where the data-branch
remote ref isn't present and no local file exists → load returns `{}` →
today-only ledger written and committed by Stage 4, discarding up to 30 days
of the velocity backbone for 新發現.
**Fix:** when the local file is absent, require a successful data-branch read
before permitting a full overwrite (or refuse to commit a ledger that shrank
from N repos to ~today's set without an explicit reset flag).

### collect-4 · **L** · dim 1
`src/fetchers/run-all.js:37-41` — enrichers run with no try/catch; a throw
propagates out of `runAll` and kills all of Stage 1. Currently benign (the
only enricher swallows its own errors) but a latent fail-hard for any future
enricher. **Fix:** wrap in try/catch, log, continue.

### collect-5 · **L** · dim 3
`src/lib/snapshot.js:20-25` — on `feeds.ok === false` the builder only WARNs
and still writes `data/feeds-snapshot.json`; Stage 4 commits it.
**Failure scenario:** a zero-item feed day publishes an empty footer
(source pills / community lists) until the next run overwrites it.
**Fix:** retain the prior committed snapshot when `items.length === 0`.

### collect-6 · **L** · dim 5
`tests/leaderboard-snapshots.test.js:36-39` — asserts the corrupt-file read
degrades to `{}` and stops there, implicitly blessing the collect-2 wipe
path; the suite stays green through that data-loss regression.
**Fix:** regression test — corrupt file, `saveSnapshot`, assert other
benches survive (red today; pins the collect-2 fix).

## Pipeline orchestration (`scripts/*.sh`, `src/pipeline/`)

### pipe-1 · **M** · dim 2
`scripts/synthesize.sh:25` and `scripts/check-faithfulness.sh:26` hardcode
`TZ=Asia/Taipei`, while `scripts/run.sh:27`, `scripts/merge-report.sh:21`,
and Stage 1 all honor `REPORT_TIMEZONE` (documented as configurable).
**Failure scenario:** with `REPORT_TIMEZONE` set to anything else, near
midnight the editorial's internal `date` (→ `report.date`) and the report
*filename* can differ by a day, and faithfulness's temporal check anchors to
the wrong day. The default masks it; the contract is still broken.
**Fix:** use `${REPORT_TIMEZONE:-Asia/Taipei}` in both scripts.

### pipe-2 · **L** · dim 1
`scripts/curate.sh:61-68` — the prompt-file block's exit status is the
trailing `printf` (always 0; `set -e` is off). If `getPrompt()` throws, the
prompt file contains only the "Execute now" boilerplate.
**Failure scenario:** a curator misconfig burns a full `claude -p` call on a
contentless prompt and surfaces later as a misleading "VALIDATION FAILED"
(or silent degradation for non-critical sections).
**Fix:** check node's rc before invoking claude.

### pipe-3 · **L** · dim 1
`src/pipeline/satisfied.js:88-95` — `report-for-day` with a missing
`metadata.json` anchor "trusts the existing report"; sequencer state is
seeded once before any stage runs (`src/pipeline/run.js:187-192`).
**Failure scenario:** a bare `node src/pipeline/run.js --resume` on a tree
with hydrated reports but wiped staging seeds merge as satisfied →
yesterday's report kept for today. Only bites direct sequencer invocation
(the `--full` path writes metadata before seeding).
**Fix:** treat a missing anchor as not-satisfied when collect is pending.

### pipe-4 · **L** · dim 1
`src/pipeline/stages.js:50` — `context` is required with `recovery: 'none'`,
yet it does live Wiki filesystem IO (including an archive write).
**Failure scenario:** a transient Wiki mount blip kills the whole day's run
with no retry — safe direction (never false success), but an avoidable
full-day outage. **Fix:** `retry-self`, or make the Wiki archive write
best-effort.

### pipe-5 · **L** · dim 7 · `security`
`scripts/merge-report.sh:43-118`, `scripts/synthesize.sh:109-129`,
`scripts/check-faithfulness.sh:38-106` — `$ACTIVE_THEME`, `$DATE`, file
paths etc. are bash-expanded inside `node -e` JS string literals. All values
are operator/env-controlled (not external input), so hardening not exploit:
a quote in any of them corrupts the generated JS.
**Fix:** pass via argv/env and read `process.argv`/`process.env` in the JS.

## Static site & CI (`site/`, `eleventy.config.js`, `.github/workflows/deploy.yml`)

### site-1 · **M** · dim 6
`.github/workflows/deploy.yml:48-59` (push) and `:63-74` (pull_request) —
neither path list includes `themes/**`, but the build genuinely depends on
theme files: `src/schemas/report.js:149` imports
`themes/<theme>/sections/<id>/schema.js` for report validation, and
`eleventy.config.js:19-58` reads theme YAML.
**Failure scenario:** a PR editing only
`themes/ai-builder/sections/discoveries/schema.js` (even a syntax error)
triggers no CI → merges green though validate/build would fail; a
theme-only push to main doesn't redeploy Pages. This is the exact gap class
the workflow comment at `:38-46` says was already closed for src/tests/scripts.
**Fix:** add `themes/**` to both path lists.

### site-2 · **L** · dim 7 · `security`
`eleventy.config.js:99-135` — `sanitizeReport()` sanitizes body-HTML fields
but no URL field is scheme-checked before rendering into
`href="{{ item.url }}"` (v2 section partials, item cards, legacy lens).
Autoescape blocks attribute breakout, so a `javascript:` URL from a
poisoned RSS→LLM chain is stopped **only** by the CSP (`base.njk:6`).
Defense-in-depth exists today; the margin is one CSP relaxation wide.
**Fix:** allowlist `http(s):` on url fields at load time.

### site-3 · **L** · dim 1
`site/feed.njk:17,26` — `pubDate` is ISO-8601
(`2026-07-21T08:00:00+08:00`); RSS 2.0 requires RFC-822. Strict aggregators
drop or reject the date. (The feed is otherwise XML-safe — autoescape
confirmed on.) **Fix:** add an `rfc822` date filter.

### site-4 · **L** · dim 2
`eleventy.config.js:49-58` — `uiStrings`/`theme` globals are registered but
referenced by zero templates; v2 partials hardcode tab labels and base.njk
hardcodes the title. Swapping `ACTIVE_THEME` does **not** change rendered
labels, partially contradicting CLAUDE.md's single-directory theme-swap
claim at the render layer. **Fix:** wire the globals into templates, or
scope the docs claim to the pipeline layer.

## Tests & docs (`tests/`, `CLAUDE.md`, `.env.example`)

### docs-1 · **M** · dim 2
`CLAUDE.md:199` claims `CLAUDE_MODEL` defaults to `claude-opus-4-6`;
`.env.example:25-26` labels it "Stage 2" with the same wrong default.
Reality: only `scripts/synthesize.sh:18` reads it (Stage 3), default
`claude-sonnet-4-6`; Stage 2 uses `CURATE_MODEL` (`scripts/curate.sh:18`).
**Failure scenario:** an operator sets the wrong knob (or expects the wrong
default) when steering model spend. **Fix:** correct both docs; mention
`CURATE_MODEL`.

### docs-2 · **M** · dim 5
`src/lib/commit.js:116-176,235-242` — the `--remove` mode (git plumbing
delete, run unattended monthly by `archive-month.sh:220`) has **zero test
coverage**; `tests/commit.integration.test.js` exercises only the add path.
**Failure scenario:** a regression in removal silently fails the archive job
or removes wrong paths; nothing catches it until the hot branch bloats.
**Fix:** integration case — seed a report on data, remove it, assert gone
from origin/data and main's tree/index untouched.

### docs-3 · **L** · dim 2
`.env.example:34-36` documents `ALLOW_STALE` — zero readers anywhere in
src/scripts (removed with the legacy-pipeline machinery). Setting it does
nothing. **Fix:** delete the block.

### docs-4 · **L** · dim 2
`.env.example:103-108` documents the retired 精選/catalog section
(`github_catalog`, min_stars 30000); `.env.example:15-16` points
`RSSHUB_URL` docs at `config.json → sources.rsshub_urls`, which now lives in
`themes/<theme>/sources.yaml:12` (and the example URL is a retired public
instance). **Fix:** update both blocks.

### docs-5 · **L** · dim 6
`.github/workflows/deploy.yml` never runs `npm run check:sources`, though
README/CLAUDE.md frame it as the guard keeping `docs/data-sources.md` in
sync. Drift accumulates silently (in sync today). **Fix:** add it to the
build job.

## Aggregator stack (`docker/aggregator/`)

### agg-1 · **L** · dim 7 · `security`
`docker/aggregator/docker-compose.yml:20` — RSSHub under
`network_mode: host` relies on `LISTEN_INADDR_ANY: "false"` to stay
loopback-only; whether this image version honors that env is unverified
(Postgres and Miniflux are confirmed loopback-bound).
**Fix:** verify with `ss -ltn` on the host; pin the behavior in a comment.

## Dimensions with nothing found

- **dim 4 (cross-platform / legacy parity):** clean — v1 lens partial still
  handles the old shape; pre-cutover v2.1 catalog/shipped conditional works.
- **dim 5 (test quality, beyond docs-2 / collect-6):** the suite is healthy —
  no tautological or mock-the-unit tests across all 82 files; past-bug
  regression coverage (auto-recover delay, dev_watch staleness, stale
  editorial, 32K split) all present.
- **dim 7 (beyond the tagged items):** no committed secrets; no injection
  path from external input to shell or fetch URLs; commit.js token hygiene
  and concurrency are sound; app.js has no DOM-injection surface.

---

## Roadmap

Batches in severity order; one batch = one concern = one future PR; all
independent unless noted. Bash-script batches (1, 2, 8) have no shell-test
harness — verification is by the artifact's own check (dry-run + sandbox
repo round-trip); JS batches get red tests first.

| # | Batch (proposed PR) | Findings | Size |
|---|---|---|---|
| 1 | `fix(archive): verify tarball integrity before upload and removal` — tar rc + `tar -tzf` member check vs MONTH_FILES, asset-presence check in `release_exists`, hydrate extraction rc + failure surfacing, rc=2 handling | archive-1 **H**, archive-3, archive-4, archive-6 | ~150 |
| 2 | `fix(archive): only archive fully-past months` — month-completeness gate | archive-2 | ~40 |
| 3 | `fix(ledgers): stop corrupt/absent state from wiping cross-day ledgers` — absent-vs-unparseable distinction, temp+rename writes, shrink guard; red tests incl. the corrupt-then-save case | collect-2 **[tested]**, collect-3, collect-6, merge-5 | ~200 |
| 4 | `fix(merge): rewrite prefix-resolved source_links to canonical ids` — plus flip the test that locks in the bare form | merge-1 | ~60 |
| 5 | `fix(discoveries): same-day rerun must not empty the seen ledger` — first_shown-aware exclusion + canonical keying | merge-2, merge-4 | ~80 |
| 6 | `fix(collect): derive feeds.ok from item count; keep prior snapshot on empty day` | collect-1, collect-5 | ~60 |
| 7 | `ci: trigger on themes/** and run check:sources` | site-1, docs-5 | ~10 |
| 8 | `fix(pipeline): honor REPORT_TIMEZONE in synthesize + faithfulness` | pipe-1 | ~10 |
| 9 | `test(commit): cover --remove mode` — enabler for batch 1's removal path | docs-2 | ~80 |
| 10 | `docs: fix CLAUDE_MODEL default, drop dead knobs, update stale env docs` | docs-1, docs-3, docs-4, site-4 (doc side) | ~40 |
| 11 | `chore(config): remove validated-but-dead config.json fields` | merge-3 | ~60 |
| 12 | `fix(site): http(s) allowlist on urls; RFC-822 pubDate` | site-2 `security`, site-3 | ~60 |
| 13 | `fix(pipeline): fail fast on prompt-gen; enricher isolation; resume anchor guard; context retry` | pipe-2, pipe-3, pipe-4, collect-4 | ~120 |
| 14 | `chore(hardening): token off argv; node -e via argv/env; verify RSSHub binding` | archive-5 `security`, pipe-5 `security`, agg-1 `security`, archive-7 | ~100 |
