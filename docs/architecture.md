# Architecture

This document explains the design decisions behind the AI Daily Report pipeline. For day-to-day usage and commands, see [README.md](./README.md). For the agent-facing operational context, see [CLAUDE.md](./CLAUDE.md).

---

## Goals

1. **Highest-quality AI analysis** — use the Claude Max subscription via `claude -p` without API billing.
2. **Minimum self-maintained code** — outsource everything else to well-maintained open source.
3. **Fully automated end-to-end** — from scheduled trigger to live site, no manual steps in the steady state.
4. **Cheap** — hosting costs $0/month (GitHub Pages + GitHub Actions free tier; the report pipeline runs on the existing Hermes host).
5. **Schema-first** — catch shape drift between LLM output and templates at validate time, never at render time.

## Hermes + CI Architecture

```mermaid
flowchart TD
  Timer["Hermes cron @ 07:00 Asia/Taipei<br/>delivery: Telegram on failure/notable completion"] --> Host

  subgraph Host["Hermes host / local repo"]
    CronRun["Hermes job or operator wrapper<br/>loads repo env + Claude auth"]
    CronRun --> Entry["repository working tree<br/>npm ci when needed"]

      subgraph Stage1["Stage 1: Collect (node src/collect.js)"]
        Fetch["runAll() — providers in parallel"]
        Fetch --> Condense["condenseAll() + buildSnapshot()"]
        Condense --> WriteStaging["write data/staging/* (local staging, not committed)"]
      end

      subgraph Stage2["Stage 2: Curate (scripts/curate.sh)"]
        Curate["4 parallel claude -p (Haiku),<br/>one per section"]
        Curate --> WriteCurated["Write data/staging/curated/<section>.json"]
      end

      subgraph Stage25["Stage 2.5: Context (scripts/hermes/build-report-context.mjs)"]
        Wiki["Hermes Wiki<br/>/home/bolin8017/Documents/Hermes/Wiki"]
        Wiki --> Context["Write bounded data/staging/report-context.md"]
      end

      subgraph Stage3["Stage 3: Synthesize (scripts/synthesize.sh)"]
        Synth["claude -p (Sonnet)"]
        Synth --> WriteEditorial["Write data/staging/editorial.json only"]
      end

      subgraph Stage4["Stage 4: Merge (scripts/merge-report.sh → src/lib/merge.js)"]
        Compose["composeReport() — no LLM,<br/>idempotent; validate source_links"]
        Compose --> WriteReport["Write data/reports/YYYY-MM-DD.json"]
        WriteReport --> Validate["Zod: ReportSchema"]
        Validate --> CommitReport["commit + push report + feeds snapshot"]
      end

      Entry --> Stage1
      Stage1 --> Stage2
      Stage2 --> Stage25
      Stage25 --> Stage3
      Stage3 --> Stage4
  end

  Timer --> CronRun
  CommitReport --> DataBranch[(data branch<br/>orphan, bot-only — reports + feeds snapshot)]

  CronRun -->|"repository_dispatch<br/>(data-committed) after report push"| GHA[GitHub Actions: deploy.yml]

  subgraph GHACI["GITHUB ACTIONS — hosted, free"]
    GHA --> Hydrate[hydrate data/ from<br/>`data` branch]
    Hydrate --> Lint[lint + test]
    Lint --> RevValidate[schema re-validation]
    RevValidate --> Build[npx @11ty/eleventy → _site/]
    Build --> Upload[upload-pages-artifact]
    Upload --> Deploy[actions/deploy-pages OIDC]
  end

  DataBranch -.-> Hydrate
  Deploy --> Pages[🌐 GitHub Pages CDN]
```

### Where each responsibility lives

| Concern | Where | Why |
|---|---|---|
| **Scheduling** | Hermes cron | Runs where Hermes already has Telegram delivery, session logs, tools, and local Wiki access. Daily target remains 07:00 Asia/Taipei. |
| **LLM call** | `claude -p` from the repository pipeline | Uses Max subscription (no API billing). It remains the primary LLM subprocess for Stage 2/3; Hermes orchestrates, observes, and reports rather than replacing the curator/synthesizer roles. |
| **Cross-day intelligence** | Hermes Wiki + bounded `report-context.md` | Keeps long-term tracking local-only and prevents public `data/memory.json` schema drift from constraining report quality. |
| **Build (11ty)** | CI | Deterministic, no secrets needed, free hosted runner. |
| **Deploy (Pages)** | CI | Official `actions/deploy-pages@v4` is the cleanest path. |

**What we tried first (and why it failed)**: the earlier architecture ran the daily pipeline as a scheduled Claude Code agent task on Anthropic Cloud Runtime (CCR). Two architectural walls:

1. **Nested `claude -p` deadlock** — CCR sessions are themselves `claude` processes, so spawning `claude -p` as a subprocess produced 74-minute SSE keepalive hangs with zero streamed tokens. Small test prompts succeeded (response <10 bytes, streaming channel never strained) which masked the issue until real-payload runs.
2. **10K-token Read-tool limit** — the agent design needed to Read a merged digest of 4 condensed sources (~19-30K tokens total). The Read tool refused anything over 10K per call. Splitting into multiple Reads worked, but by that point the design was hostile to CCR's constraints.

The current Hermes-hosted/local workflow sidesteps both: `claude -p` is the primary subprocess launched from the repository pipeline (no nested cloud runtime), and staging files are read from disk rather than piped through a giant prompt body. The persona/voice/slop rules live in the theme bundle (`themes/ai-builder/synthesizer.md` + `quality.md`) and are assembled into the prompt at invocation time, keeping the voice rules while shedding the agent-loop framing.

## Data flow

```mermaid
sequenceDiagram
  autonumber
  participant Timer as Hermes cron
  participant CronRun as Hermes/operator wrapper
  participant Entry as repository working tree
  participant Collect as src/collect.js
  participant Fetchers as src/fetchers/*
  participant Seq as src/pipeline/run.js
  participant Curate as scripts/curate.sh (Haiku × 4)
  participant Context as scripts/context.sh
  participant Synth as scripts/synthesize.sh (Sonnet)
  participant Faith as scripts/check-faithfulness.sh
  participant Merge as scripts/merge-report.sh
  participant Git
  participant GHA as GitHub Actions
  participant Pages

  Timer->>CronRun: trigger (07:00 Asia/Taipei)
  CronRun->>CronRun: load env / secrets and set workdir
  CronRun->>Entry: run repository pipeline
  Entry->>Entry: git pull origin main when needed
  Entry->>Entry: npm ci when package-lock changed

  Note over Entry,Collect: Stage 1: Collect
  Entry->>Collect: exec node src/collect.js
  Collect->>Fetchers: runAll() — providers in parallel
  Fetchers->>Collect: raw objects (feeds, trending, search, developers, leaderboards, mops, hf, arxiv)
  Collect->>Collect: condenseAll(raw) → ≤8500-token objects
  Collect->>Collect: buildSnapshot(raw.feeds) → data/feeds-snapshot.json
  Collect->>Collect: write data/staging/* (local staging, not committed)

  Note over Entry,Merge: Stage 2-4: Analyze (curate → synthesize → merge)
  Entry->>Seq: node src/pipeline/run.js --resume
  Seq->>Curate: bash scripts/curate.sh <section> (×4 — parallel batch)
  Curate->>Curate: claude -p (Haiku), read staging slice + themes/.../sections/<id>/curator.md
  Curate->>Curate: Write data/staging/curated/<section>.json
  Seq->>Context: bash scripts/context.sh
  Context->>Context: build report-context.md from Hermes Wiki + run metadata
  Seq->>Synth: bash scripts/synthesize.sh
  Synth->>Synth: claude -p (Sonnet), read curated/* + report-context.md + themes/.../synthesizer.md + quality.md
  Synth->>Synth: Write data/staging/editorial.json only
  Seq->>Faith: bash scripts/check-faithfulness.sh
  Faith->>Faith: temporal + attribution audit, soft-repair editorial.json (never-abort)
  Seq->>Merge: bash scripts/merge-report.sh
  Merge->>Merge: composeReport() — editorial + curated → report; validate source_links
  Merge->>Merge: Zod validate ReportSchema
  Merge->>Merge: Write data/reports/YYYY-MM-DD.json
  Seq->>Git: commit + push report + feeds snapshot (x-access-token URL)

  CronRun->>GHA: POST repository_dispatch (data-committed)
  Note over GHA: fired by the Hermes cron production pipeline<br/>right after the push (replaced the old schedule poll)
  GHA->>Git: fetch + checkout origin/data -- data/
  GHA->>GHA: lint + test + validate + 11ty build
  GHA->>Pages: actions/deploy-pages OIDC
  Pages-->>Timer: live in ~30s
```

### Why four stages instead of one analyze call

The pipeline was a single `claude -p` "analyze" stage through early 2026, then briefly a three-stage curate → synthesize split. The current four-stage shape (collect → curate → synthesize → **merge**) is the durable fix for a specific failure that hit on 2026-05-24: the synthesizer, asked to emit the *entire* report (editorial layer **plus** all curated `shipped`/`pulse`/`market`/`tech` content), ran into the 32K output-token cap mid-write and produced a truncated, schema-invalid report.

Raising the cap only buys time — a richer signal day would hit it again. The structural fix is to stop the LLM from re-emitting content it didn't author. So Stage 3 now writes **only** the editorial layer (`lead` / `signals` / `ideation`) to `data/staging/editorial.json` — roughly 3-5K tokens, comfortably under any cap — and Stage 4 (`scripts/merge-report.sh` → `src/lib/merge.js`) mechanically composes the final `data/reports/<date>.json` by stitching `editorial.json` together with the already-validated `curated/*.json` from Stage 2. The merge is pure / deterministic / idempotent (no LLM, no token cap, re-running it yields the same bytes), and it checks that every `source_links` id referenced from the editorial layer resolves to a curated item; an id that doesn't (after slug-suffix–tolerant prefix matching) is dropped and logged rather than aborting the run — the citing item still renders, just without that dead cross-tab anchor. The synthesizer prompt is the primary defense (cite-or-empty, never invent an id); this deterministic drop is the backstop. (Originally a hard abort; relaxed to a degrade on 2026-06-04, after concluding one hallucinated id should not kill a whole day's report — and that CLI structured-output / JSON-Schema enum enforcement is too fragile for these schemas to prevent it at the source.)

A side benefit: the curators (4 parallel Haiku calls, one per section) and the synthesizer (1 Sonnet call) now have cleanly separated jobs. Curators classify and filter raw items into sections cheaply; the expensive model spends its whole budget on the editorial voice rather than transcribing items it was handed.

## Schema-first design

Every data shape is defined once in `src/schemas/` and reused everywhere:

```mermaid
flowchart LR
  Sections[themes/&lt;theme&gt;/sections/*/schema.js] --> Build[buildReportSchema&#40;&#41;<br/>composes ReportSchema]
  Build --> Curators[Curators write to<br/>each section's shape]
  Build --> Validator[Validator at runtime]
  Build --> Tests[Vitest tests]
```

`ReportSchema` is no longer a single static object — it's **composed at runtime** by `buildReportSchema()` (in `src/schemas/report.js`) from the per-section `schema.js` files of the active theme. Adding or removing a report section is therefore a folder-level operation under `themes/<theme>/sections/` rather than an edit to a monolithic schema. This means:

1. When you change a section's `schema.js`, that section's curator prompt should be updated to match (but the composed validator catches it if you forget).
2. When an LLM stage's output drifts (a common LLM problem), validation aborts the pipeline before broken data hits `_site/`.
3. Vitest tests assert that real fixture data passes the schema, catching schema-vs-reality drift on every commit.

**Schema versioning**: post-cutover reports are `schema_version: 2.1`; legacy `2.0` reports (pre-2026-05-24) still validate and render through the same v2 unified partial. `buildReportSchema()` accepts both via a `z.union([z.literal(2), z.literal(2.1)])`, so the archive stays renderable without a migration pass.

**The passthrough trade-off**: `ReportSchema` uses `.passthrough()` at its top level and makes most sub-fields optional. This is deliberate — an LLM's output shape naturally drifts with prompt iteration, and a strict schema would reject valid-looking reports for cosmetic reasons. The templates handle missing fields as empty renders rather than crashes.

## Agent prompt as the design surface

The persona / voice prompt at `themes/ai-builder/synthesizer.md` (with `themes/ai-builder/quality.md`) is the single biggest lever for output quality on this project, and it's designed around a specific philosophy: **outcome-oriented prompting**, not mechanism-prescriptive rule-listing. (Before the 2026-05-24 theme-bundle move these files lived under `.claude/synthesizer.md` and `.claude/daily-report-quality.md`; relocating them into `themes/<theme>/` is what makes swapping the brief's whole focus a single-directory edit — see "Theme bundle" below.)

### Why outcome-oriented

The original prompt was a ~300-line rule book — hard counts (3 ideas, 12-20 shipped items, ≤5 dev_watch per region), length caps (800-1500 chars HTML for lead), banned phrase lists (innovative, ecosystem, leverage, game-changer...). This approach was brittle in three ways:

1. **False positives**: "partner ecosystem with $100M fund" is legitimate industry vocabulary; the banned-phrase list flagged it as slop. Mechanical word filters can't distinguish load-bearing industry terms from corporate marketing filler.
2. **False negatives**: slop isn't limited to 10 words. "This represents a significant step forward for the industry" contains zero banned words but is pure slop. Sentence-level structure patterns (rule-of-three, participial tack-ons, negative parallelisms) matter more than vocabulary.
3. **Over-constraint of judgment**: Claude Opus 4.5/4.6 responds better to "describe the outcome you want" than "enumerate mechanical rules". Hardcoded counts tell the model "hit this number" — not "write what the day's signal richness warrants". Anthropic's own Claude 4.6 best-practices doc explicitly warns against this: *"Tell Claude what to do instead of what not to do"* and *"dial back aggressive language like CRITICAL / MUST"*.

### What the current prompt does instead

The rewrite of Steps 6 (editorial writing) and 7 (self-check) draws on a research round that surveyed:

- `langchain-ai/open_deep_research` — "each section should be as long as necessary"
- `assafelovic/gpt-researcher` — "MUST determine your own concrete and valid opinion. Do NOT defer to general and meaningless conclusions"
- `anthropics/anthropic-cookbook` — query-type triage, "NEVER create a subagent to generate the final report", the `<frontend_aesthetics>` template shape (diagnosis → positive direction → negative specifics → attitude directive)
- `adenaufal/anti-slop-writing` — structural patterns (句長分布、Rule of Three、分詞尾巴、否定對仗) catch slop that vocabulary filters miss; ICLR 2026 Antislop paper finding
- Anthropic Claude 4.6 best practices — positive phrasing, dial back MUSTs, examples over rules
- Stratechery / Latent Space / Pragmatic Engineer / Money Stuff voice analysis — named protagonist openers, transitions by contrast (not connective adverbs), role-anchored action advice

Synthesis principles implemented in the current prompt:

1. **Open with diagnosis, not instructions** — Step 6 starts with "你天然會收斂到『安全、平均、每一天都適用』的寫法" so the model knows *why* every subsequent rule exists
2. **Describe the reader, not the format** — reader is locked as "AI engineer who builds (RAG/VLM/fine-tuning/agent/MCP)", with explicit negative carve-outs ("not a decision-maker; if you catch yourself writing 'discuss with your CTO', stop")
3. **Single slop test** — "delete this sentence; what specific thing does the reader lose?" replaces the entire word blacklist
4. **Positive paragraph examples** — three actual reviewer-praised passages from earlier iterations are embedded as `<example>` blocks to show voice and rhythm, not just describe it
5. **Tier A / Tier B watchlist (not banlist)** — Tier A words (`innovative`, `game-changing`, `cutting-edge`) default to cutting; Tier B words (`ecosystem`, `leverage`, `platform`) only require judgment check
6. **Structural anti-slop** — 5 rules attacking sentence-length uniformity, rule-of-three compulsion, participial tack-ons, negative parallelisms, em-dash overuse
7. **Chinese translation-smell patterns** — 12 specific 翻譯腔 patterns (`被`字句濫用、英式長定語、空間隱喻直譯、`自己` 當 "itself" 殘留, etc.) sourced from a Chinese-language editor external review
8. **Force an opinion, forbid hedging** — "you must take a position. A confident wrong call beats a hedged 'interesting developments to watch'. You can be wrong; you can't be boring"
9. **Role-anchored action advice** — format is "`when you're [specific state] doing [specific thing], [specific code-level action], because [specific reason]`"; generic "consider this trend" is explicitly flagged
10. **Length follows signal** — no character targets; the one length rule is "what can you delete without losing information?"

### External review as calibration

A pre-finalization version of the prompt was audited by four external reviewers (dispatched as separate sub-agents with different personas):

| Reviewer | Role | Caught |
|---|---|---|
| **Tech editor** (FT / Bloomberg / The Information voice) | Editorial quality, attribution, news value | Unverifiable "first-ever" superlative claims, 1-hour cross-vendor benchmark claim that's actually 3 days of engineering, commercial path that ignored legal-tech procurement realities |
| **Chinese-language editor** (天下 / 報導者 / 端傳媒 senior editor) | 翻譯腔, 句長節奏, 套語, 詞彙純度 | 12 specific translation-smell sentences across lead + ideas + signals, "繼續發酵" / "的轉折點" / "結構性切換" half-slop terms, sentence-length flatness in the weakest lead paragraph |
| **Strategy analyst** (Stratechery / McKinsey-style) | Strategic insight quality, prediction scorecard, idea business viability | A fundamental technical error in Idea #1 (MegaTrain CPU-offload being "天作之合" with Apple Silicon unified memory — actually the opposite direction), the biggest missed story of the day (an empty `google/agents-cli` repo that was "the dog that didn't bark"), unfalsifiable compound-OR predictions |
| **Non-AI product manager** (Notion / Linear / Figma tier SaaS PM) | Readability, jargon barrier, bullshit detector, subscribe decision | `arc-xxx-xxx` kebab-case memory slugs leaking into reader-facing prose (9 occurrences), "audience split personality" (report served two masters — builder and decision-maker — and served neither well), "carve-out" English term that's inaccessible to non-AI readers even when they read fluent Chinese |

All 4 reviewers independently flagged **pattern-matching to overconfidence** (e.g., "4 events on the same day is a coincidence, not a trend, unless you can name the mechanism"). Three of the 4 independently praised the same paragraph (an HN-story contrast juxtaposing Anthropic's political statements with unanswered billing tickets). The convergence/divergence matrix resolved directly into prompt rule changes.

### Iteration infrastructure

Prompt iteration happens locally via two complementary paths:

- `bash scripts/run.sh --skip-push` — runs Stage 1 + the analyze stages (curate → synthesize → merge) without pushing, useful for end-to-end validation of a prompt change.
- `bash scripts/run.sh --analyze` — runs the analyze stages only (reuses existing staging data), useful for rapid prompt iteration without re-fetching sources. The inner loop is ~2-3 minutes per prompt tweak.

The theme prompts (`themes/ai-builder/synthesizer.md`, `quality.md`, and the per-section `curator.md` files) are read fresh on every invocation, so editing a prompt doesn't require a rebuild.

**The convergence bar**: "would I personally want to read this report if I wasn't the one writing it?" Three iteration rounds (v1-initial → v2-audience-lock → v3-slug-precision) were needed to reach convergence on the current prompt. That bar survived two later structural refactors — the VM migration's move from a 10-step agent workflow to a direct `claude -p` call, and the 2026-05-24 split that pushed item-classification down to the Haiku curators so the Sonnet synthesizer writes only the editorial voice layer.

## Theme bundle

Everything that defines *this particular brief* — persona, voice, anti-slop rules, source list, section definitions, UI strings — lives under `themes/<ACTIVE_THEME>/` (default `ai-builder`). Before 2026-05-24 these assets were scattered: the persona prompt under `.claude/lenses/`, the source list and lens overlays inside `config.json`, curator prompts under `.claude/curators/`, section schemas inline in `src/schemas/report.js`, and tab labels hardcoded in templates. Swapping the brief's focus (say, "AI builder" → "ML researcher") meant touching eight-plus files across the repo and was easy to get half-done.

The bundle collapses that into a single directory:

```
themes/ai-builder/
├── theme.yaml        # manifest: persona, model assignment, section list + order
├── sources.yaml      # GitHub topics + RSS/API feed config (moved out of config.json)
├── ui-strings.yaml   # tab labels, site title, archive strings
├── synthesizer.md    # editorial prompt — persona / voice (was .claude/synthesizer.md)
├── quality.md        # anti-slop rules (was .claude/daily-report-quality.md)
└── sections/<id>/    # one per report section (shipped, pulse, market, tech)
    ├── manifest.yaml # id, tab label, critical flag, groups
    ├── curator.md    # this section's curator prompt (was .claude/curators/<id>.md)
    ├── schema.js     # Zod sub-schema, composed by buildReportSchema()
    └── partial.njk   # 11ty render partial
```

The loader is `src/lib/theme.js` (`loadTheme` / `loadSection` / `listActiveSections`). The fetcher providers read their source list through `getThemeSources()` rather than `config.json`, the report schema is composed from the active sections' `schema.js` files, and 11ty discovers section partials by convention. The upshot: adding a section is `mkdir themes/ai-builder/sections/<id>` + four files + a line in `theme.yaml`; swapping the whole focus is `cp -r` the theme dir, edit, and set `ACTIVE_THEME`. No edits to `src/`, `scripts/`, or `eleventy.config.js`.

**What stayed in `config.json`**: only cross-theme infrastructure tuning — the `providers` block (Firecrawl monthly cap, Jina Reader base URL) and `report` defaults (language, item caps). The `sources` and `lenses` blocks that used to live there moved into each theme's `sources.yaml`, because they *are* theme-specific.

## Fetcher strategy

Fetchers are organized as **providers** under `src/fetchers/providers/`, each self-registering with `_registry.js` and run in parallel by `run-all.js`. Sources (RSS routes, GitHub topics, developer lists) come from the active theme's `sources.yaml` via `getThemeSources()`, not from `config.json`.

### Native-RSS ingestion via self-hosted Miniflux (2026-06-06 cutover)

The native-RSS feed half (~37 sources: blogs, vendor blogs, Taiwan/Chinese media) is no longer fetched per-source through provider chains. A self-hosted **Miniflux** — fed by a self-hosted **RSSHub**, both in `docker/aggregator/` under host networking and bound to `127.0.0.1` — polls every feed 24/7; Stage 1 does one windowed `GET /v1/entries` pull (`src/fetchers/miniflux.js`) and merges the result into the feeds bucket. The feed list of record is `themes/<theme>/feeds.opml` (generated from the registry by `scripts/gen-feeds-opml.mjs`, provisioned into Miniflux by `scripts/miniflux-sync.mjs`); `collect.js` partitions sources by it — feeds in the OPML come from Miniflux, the rest from chains.

Three motivations: (1) continuous polling removes the per-day-snapshot sparsity (a heavy fetch day no longer collapses a source to one item — the problem [docs/superpowers condense redesign] also targeted); (2) it centralizes feed management + dead-feed visibility instead of hand-maintained chains + a public RSSHub instance list; (3) self-hosting RSSHub removes public-instance drift.

**Carve-outs stay on chains:** HN/Lobsters (Plan X ranks them by native score, which plain RSS/Miniflux cannot carry), the RSSHub-only `dev-to-top` / `anthropic-news`, the very slow `sk-hynix-news` (21–43 s, exceeds Miniflux's fetch timeout), and all structured sources.

**Two design wrinkles worth noting:** (a) Miniflux refuses to fetch loopback addresses (SSRF guard) and rewrites a feed's stored url when it redirects — so RSSHub stays loopback-only for the chain's use, and source identity is carried by tagging each Miniflux feed's *title* with the registry source id and reading it back from `entry.feed.title` (redirect-proof) rather than matching on url. (b) The Miniflux pull window (16 d) must exceed section-condense's widest per-source recency window (14 d), else long-window blogs get pre-starved; precise per-source windowing stays in section-condense. There is no chain fallback for Miniflux-handled feeds — an outage degrades the feed half gracefully; if Miniflux is unconfigured (local dev), collect falls back to chains.

| Provider | Source | Method | Why |
|---|---|---|---|
| `providers/rsshub.js` + `native-rss.js` / `native-json.js` | RSSHub + native JSON/RSS | fetch + parse | Theme-driven feed list; RSSHub instances tried in order, native routes bypass RSSHub |
| `providers/github-trending-html.js` | github.com/trending | cheerio + Octokit enrichment (README excerpts) | HTML scraping is unavoidable, but cheerio is far more robust than regex |
| `providers/github-search-api.js` | GitHub Search API | Octokit + `created:>30daysAgo` freshness-first query + README enrichment per result (batched 5 at a time) | Returns genuinely fresh topic-matched repos for the shipped section's **discovery picks** — not "popular-with-CI-activity" heavyweights |
| `providers/github-developers-api.js` | GitHub Search Users + Repos APIs | Octokit (batches of 5) + README enrichment | Used to be 273 lines of bash + curl + jq; rewritten to reuse Octokit's built-in throttling and retry |
| `providers/hf-trending-json.js`, `leaderboard-html.js`, `mops-twse-openapi.js`, `arxiv-rss.js` | HuggingFace, leaderboards, TWSE MOPS, arXiv | per-source fetch | Theme-specific signal sources; written raw to staging (bypass condense) since payloads are small + structured |

**HN scoring trick**: the front-page list doesn't expose scores, so the HN provider enriches each item's `score` and `comments` via the Algolia API (`src/fetchers/enrichers/hn-algolia.js`) in parallel batches. A separate `providers/hn-firebase.js` covers the Firebase item API.

**github-search freshness rewrite**: the original query was `topic:X stars:>50 pushed:>yesterday`. In 2026, this returned the same long-lived heavyweights every day (langchain 132k★, ShareX from 2013, etc.) because every popular repo has nightly CI commits matching "pushed yesterday". The agent correctly refused to put langchain in "今日上線", so the fetcher was contributing 0 items to shipped. Query rewritten to `topic:X stars:>100 created:>30daysAgo` + README excerpt enrichment + higher per-topic limit (5 → 10). The result: the shipped section now gets 3–5 discovery picks per report from repos that haven't reached HN / Trending yet, which is the only way to differentiate the brief from "today's HN front page + github trending".

## Memory model

The active cross-day memory is the local Hermes Wiki at `/home/bolin8017/Documents/Hermes/Wiki`, not a repo-committed JSON file. The pipeline projects that long-term intelligence into a bounded `data/staging/report-context.md` before Stage 3.

This split keeps three boundaries clean:

- **Public report artifacts** stay on the `data` branch (`data/reports/*.json` + `data/feeds-snapshot.json`).
- **Private intelligence** stays local-only in Hermes Wiki, where Hermes can track arcs and themes without publishing internal notes.
- **LLM prompt context** stays bounded and auditable through `report-context.md`, avoiding unbounded memory growth and schema coupling.

`data/memory.json` and its `MemorySchema` have been removed from the codebase entirely; cross-day state lives only in the local Hermes Wiki.

## Quality tooling

| Tool | Purpose | Why this and not alternatives |
|---|---|---|
| **Biome** | Lint + format JS/JSON | One binary, one config, 10× faster than ESLint+Prettier |
| **Vitest** | Schema smoke tests | Native ESM, native TS, 10× faster than Jest |
| **Zod** | Schema validation | TypeScript-first, single source of truth |
| **Octokit** | GitHub API client | Bundles `@octokit/plugin-throttling` and `@octokit/plugin-retry` by default |
| **cheerio** | HTML parsing | Used in `providers/github-trending-html.js` to replace a regex-based scraper |
| **11ty** | Static site build | Mature, fast, ESM-native, no React/Vue overhead for content sites |

## Deploy

GitHub Pages source: **GitHub Actions** (`build_type: workflow`).

The legacy `gh-pages` branch is no longer used. Build runs in CI via `actions/deploy-pages@v4`, which:

1. Builds `_site/` in a clean Ubuntu runner
2. Uploads as a Pages artifact (signed via OIDC)
3. Deploys atomically (no force-push, no orphan commits)

## Scheduled deployment via Hermes cron

Production runs under **Hermes cron** at 07:00 Asia/Taipei, with Telegram delivery for failures or notable completion. The pipeline runs directly against a working copy of the repository on the Hermes host, which already has Claude Code auth, repo access, and the local Hermes Wiki — no container and no separate scheduler.

**Pipeline lifecycle:**

**Stage 1 — Collect** (deterministic Node process, `src/collect.js`):

1. Compute today's date in `Asia/Taipei`
2. `runAll()` — providers run in parallel; tolerate degraded sources
3. `buildSnapshot(raw.feeds)` — writes `data/feeds-snapshot.json` for 11ty
4. `condenseAll(raw)` — ≤8500-token objects for prompt-size control
5. Write condensed data + metadata to `data/staging/`
6. **No commit here** — Stage 1 only writes staging; commits happen in Stage 4. Staging stays ephemeral, but the `feeds-snapshot.json` it builds is committed by Stage 4 (the 11ty footer needs it at build time). The `data` branch otherwise stays trimmed to reports + `feeds-snapshot.json`.

**Stages 2-4 — Analyze** (`scripts/run.sh` drives the `src/pipeline/run.js` sequencer over three sub-stages):

1. **Curate** (`scripts/curate.sh`) — 4 parallel `claude -p` Haiku subprocesses, one per section (shipped / pulse / market / tech). Each reads its staging slice + `themes/<theme>/sections/<id>/curator.md` and writes validated JSON to `data/staging/curated/<section>.json`. Critical-section (shipped, pulse) failure aborts; non-critical (market, tech) failure logs degraded.
2. **Context** (`scripts/hermes/build-report-context.mjs`) — projects local Hermes Wiki intelligence into bounded `data/staging/report-context.md`.
3. **Synthesize** (`scripts/synthesize.sh`) — one `claude -p` Sonnet call. Reads `curated/*` + raw staging + `report-context.md` + `themes/<theme>/synthesizer.md` + `quality.md`, writes **only** the editorial layer to `data/staging/editorial.json`.
4. **Merge** (`scripts/merge-report.sh` → `src/lib/merge.js`) — mechanical, no LLM, idempotent. Composes `data/reports/YYYY-MM-DD.json` from `editorial.json` + `curated/*.json`; a `source_links` id that resolves to no curated item is dropped and logged (the citing item still renders), not aborted.
5. Validate outputs: composed `ReportSchema.parse(report)`.
6. Commit via `src/lib/commit.js` — stages the report + feeds snapshot files, commits as `report: <date> daily creative brief`, and pushes to the `data` orphan branch (git plumbing + `x-access-token:$GITHUB_TOKEN` URL rewrite; never touches `main`'s working tree).
7. The pipeline POSTs a `repository_dispatch` (type `data-committed`) as soon as the push above lands, firing `deploy.yml`, which hydrates `data/` from the `data` branch and deploys to Pages within seconds. The dispatch is needed because the `data` orphan has no `.github/workflows/` tree, so pushes there cannot themselves fire the workflow — and it replaced a `schedule: 0 0 * * *` poll that GitHub drifted by hours, lagging the published site.

**Why Hermes cron instead of GitHub Actions `schedule:`:** GHA schedules run on hosted runners without Claude Code subscription auth, forcing `ANTHROPIC_API_KEY` billing or OAuth secret juggling. Hermes cron runs on the host that already has Claude Code auth, repo access, Telegram delivery, and the local Hermes Wiki.

**Resource budget**: keep pipeline subprocesses bounded with explicit timeouts and failure reporting rather than silent runaway jobs, so a stuck `claude -p` never starves colocated services on the host.

## Storage: hot/cold split

Reports accumulate forever, but the `data` orphan branch is cloned on every container run and every CI build — an unbounded archive there would slow both. So the report store is split:

- **Hot** — the most recent `HOT_DAYS` (default 60) of `data/reports/*.json` plus `data/feeds-snapshot.json` live on the `data` branch, always present after a clone.
- **Cold** — older reports are packed monthly into `reports-YYYY-MM.tar.gz` (+ a `.sha256`) and uploaded to **GitHub Releases** under `archive-YYYY-MM` tags. `scripts/archive-month.sh` runs monthly under Hermes cron, removes the now-archived files from the `data` branch, and is idempotent (skips a month whose Release already exists).

At CI build time `scripts/hydrate-archive.sh` pulls the last `HYDRATE_MONTHS` (default 12) months of cold tarballs back into `data/reports/` so 11ty can paginate them into archive pages. Both scripts talk to the GitHub REST API directly with **curl**, not the `gh` CLI — the production runtime isn't guaranteed to have `gh` installed, and adding it just for an upload wasn't worth the dependency.

This is why Stage 1's bulky staging (condensed source dumps, ~hundreds of KB) and Hermes-derived `report-context.md` stay off the `data` branch: keeping the branch lean and public-only is the point, so only durable public artifacts (reports plus the small, overwritten `feeds-snapshot.json` the 11ty footer reads at build time) belong there.

## Trade-offs and known issues

| Issue | Impact | Mitigation |
|---|---|---|
| **GitHub Trending HTML can change** | github-trending provider returns 0 repos | cheerio is more resilient than regex; `runAll` tolerates degraded sources; schema validator catches empty report and aborts the deploy |
| **External RSSHub dependency** (list in the theme's `sources.yaml`) | Multiple feeds can time out together if a shared instance is slow | `rsshub.js` tries each instance per request, falling through on `5xx` / timeout / network error — so when one instance is down, the next request gets the same route from the backup. `4xx` is treated as a route-level error (no retry, since a bad route will fail on every instance). `runAll` additionally tolerates source-level failure at the outer level. Self-hosting RSSHub was rejected as a maintenance burden for a once-a-day read. |
| **HN Algolia API is undocumented** | Score enrichment may break | Wrapped in try/catch; missing scores degrade report quality but don't break the pipeline |
| **LLM synthesis is the quality single point of failure** | Schema-invalid output blocks the day | The synthesizer writes only the small editorial layer (no 32K-cap exposure); the merge step composes and validates the report deterministically; Zod validation in the merge stage aborts the run before commit. Yesterday's report stays live. |
| **Hermes cron / host failure** | Report missed for the day | Hermes cron should deliver failures back to Telegram. Manual recovery remains `bash scripts/run.sh --skip-push`, followed by validation before enabling publish. |
| **Claude subscription token expires** | `claude -p` calls start failing | `~/.claude` needs to be re-authed; pipeline fails loudly rather than silently degrading. Re-run `claude /login` to re-auth. |

## Future work

Things considered but not implemented:

- **Article content extraction with `@mozilla/readability`** — would feed the LLM fuller context than titles alone.
- **Missed-run catchup** — the next morning could detect a missing `data/reports/YYYY-MM-DD.json` from yesterday and produce a two-day brief. In practice the failure mode is rare enough not to justify the complexity yet.
- **Sentry / Better Stack error tracking** — for now `/var/log/ai-daily-report.log` + CI red-X on GHA is enough. Would become useful if the pipeline grew past one-person operations.
- **Prediction tracking dashboard** — separate page rendering historical prediction outcomes.

Things considered and explicitly **not** pursued:

- **TypeScript migration** — schemas already give the value TS would add; a half-TS `checkJs` setup existed briefly and caught nothing useful.
- **CHANGELOG.md** — solo personal project, `git log` is the change log (and history is periodically squashed to a single init commit when the project reaches a new "this is what it is now" equilibrium).
- **Split into two newsletters (builder + decision-maker)** — considered after the non-AI PM external reviewer flagged "audience split personality". Rejected in favor of locking the audience to builders only; the README, prompt, and CLAUDE.md all explicitly scope the project to AI engineers who ship code. A separate decision-maker brief would be a fundamentally different product.
