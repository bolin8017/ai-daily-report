# Architecture

This document explains the design decisions behind the AI Daily Report pipeline. For day-to-day usage and commands, see [README.md](./README.md). For the agent-facing operational context, see [CLAUDE.md](./CLAUDE.md).

---

## Goals

1. **Highest-quality AI analysis** — use the Claude Max subscription via `claude -p` without API billing.
2. **Minimum self-maintained code** — outsource everything else to well-maintained open source.
3. **Fully automated end-to-end** — from scheduled trigger to live site, no manual steps in the steady state.
4. **Cheap** — production infra costs $0/month (always-free GCP e2-micro + GitHub Pages + GitHub Actions free tier).
5. **Schema-first** — catch shape drift between LLM output and templates at validate time, never at render time.

## The VM + CI Architecture

```mermaid
flowchart TD
  Timer["systemd timer @ 04:00 Asia/Taipei<br/>Persistent=true"] --> Host

  subgraph Host["GCP e2-micro VM"]
    CronRun["scripts/cron-run.sh<br/>loads GITHUB_TOKEN from ~/.ai-daily-report.env"]
    CronRun --> Docker["docker run --rm ai-daily-report:latest<br/>--memory=600m --memory-swap=1g"]

    subgraph Container["Docker container (node:22-slim + claude CLI)"]
      Entry["scripts/docker-entrypoint.sh<br/>git pull + npm ci --prefer-offline"]

      subgraph Stage1["Stage 1: Collect (node src/collect.js)"]
        Fetch["runFetchers() — 4 parallel"]
        Fetch --> Condense["condenseAll() + buildSnapshot()"]
        Condense --> WriteStaging["write data/staging/*"]
        WriteStaging --> CommitStaging["commitAndPush() staging data"]
      end

      subgraph Stage2["Stage 2: Analyze (scripts/analyze.sh → claude -p)"]
        Prompt["assemble prompt from agent MD + quality rules"]
        Prompt --> ClaudeP["claude -p --allowedTools Read,Write"]
        ClaudeP --> ReadStaging["Read data/staging/* files"]
        ReadStaging --> Analyze["analyze + synthesize"]
        Analyze --> WriteReport["Write data/reports/YYYY-MM-DD.json\n+ data/memory.json"]
        WriteReport --> Validate["Zod: ReportSchema + MemorySchema"]
        Validate --> CommitReport["commit + push report & memory"]
      end

      Entry --> Stage1
      Stage1 --> Stage2
    end
  end

  Timer --> CronRun
  CommitReport --> DataBranch[(data branch<br/>orphan, bot-only)]

  GHACron[scheduled cron<br/>21:00 UTC daily] --> GHA[GitHub Actions: deploy.yml]

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

### Why VM + systemd timer + Docker?

| Concern | Where | Why |
|---|---|---|
| **Scheduling** | systemd timer | Zero cost (already-running VM), reliable, full logs via `journalctl`. `Persistent=true` catches up missed runs (e.g., after a VM reboot). |
| **LLM call** | `claude -p` inside the container | Uses Max subscription (no API billing). Runs as primary session — no nested-claude deadlock. Credentials persist in a bind-mounted `~/.claude`. |
| **Isolation** | Docker | Caps memory to 600m so a synthesis spike can't OOM the host's other services. Rebuildable from Dockerfile. |
| **Build (11ty)** | CI | Deterministic, no secrets needed, free hosted runner. |
| **Deploy (Pages)** | CI | Official `actions/deploy-pages@v4` is the cleanest path. |

**What we tried first (and why it failed)**: the earlier architecture ran the daily pipeline as a scheduled Claude Code agent task on Anthropic Cloud Runtime (CCR). Two architectural walls:

1. **Nested `claude -p` deadlock** — CCR sessions are themselves `claude` processes, so spawning `claude -p` as a subprocess produced 74-minute SSE keepalive hangs with zero streamed tokens. Small test prompts succeeded (response <10 bytes, streaming channel never strained) which masked the issue until real-payload runs.
2. **10K-token Read-tool limit** — the agent design needed to Read a merged digest of 4 condensed sources (~19-30K tokens total). The Read tool refused anything over 10K per call. Splitting into multiple Reads worked, but by that point the design was hostile to CCR's constraints.

A plain VM sidesteps both: `claude -p` is the primary process (no nesting), and in-process data flow has no tool-mediated size limits. The original `.claude/agents/daily-report.md` prompt became the text body passed to `claude -p` with an appended "output only JSON" instruction, keeping the voice/slop rules while shedding the agent-loop framing.

## Data flow

```mermaid
sequenceDiagram
  autonumber
  participant Timer as systemd timer
  participant CronRun as scripts/cron-run.sh
  participant Docker as Docker engine
  participant Entry as docker-entrypoint.sh
  participant Collect as src/collect.js
  participant Fetchers as src/fetchers/*
  participant AnalyzeSh as scripts/analyze.sh
  participant Claude as claude -p
  participant Git
  participant GHA as GitHub Actions
  participant Pages

  Timer->>CronRun: trigger (04:00 Asia/Taipei)
  CronRun->>CronRun: load ~/.ai-daily-report.env
  CronRun->>Docker: run ai-daily-report:latest --memory=600m
  Docker->>Entry: start (GITHUB_TOKEN injected, /home/pipeline/.claude:ro mounted)
  Entry->>Entry: git pull origin main (into /workspace volume)
  Entry->>Entry: npm ci --omit=dev --prefer-offline

  Note over Entry,Collect: Stage 1: Collect
  Entry->>Collect: exec node src/collect.js
  Collect->>Fetchers: runFetchers() — Promise.all × 4
  Fetchers->>Collect: raw objects (feeds, trending, search, developers)
  Collect->>Collect: condenseAll(raw) → 4 × ≤8500-token objects
  Collect->>Collect: buildSnapshot(raw.feeds) → data/feeds-snapshot.json
  Collect->>Collect: write data/staging/*
  Collect->>Git: commitAndPush staging data (x-access-token URL)

  Note over Entry,Claude: Stage 2: Analyze
  Entry->>AnalyzeSh: exec scripts/analyze.sh
  AnalyzeSh->>AnalyzeSh: assemble prompt (agent MD + quality rules)
  AnalyzeSh->>Claude: claude -p --allowedTools Read,Write
  Claude->>Claude: Read data/staging/* files
  Claude->>Claude: analyze + synthesize
  Claude->>Claude: Write data/reports/YYYY-MM-DD.json + data/memory.json
  AnalyzeSh->>AnalyzeSh: Zod validate ReportSchema + MemorySchema
  AnalyzeSh->>Git: commit + push report & memory (x-access-token URL)

  Note over GHA: GHA cron fires independently<br/>at 21:00 UTC daily (not caused<br/>by the Stage 2 push)
  GHA->>Git: fetch + checkout origin/data -- data/
  GHA->>GHA: lint + test + validate + 11ty build
  GHA->>Pages: actions/deploy-pages OIDC
  Pages-->>Timer: live in ~30s
```

## Schema-first design

Every data shape is defined once in `src/schemas/` and reused everywhere:

```mermaid
flowchart LR
  Schema[src/schemas/report.js<br/>ReportSchema] --> Agent[Agent reads it as<br/>output contract]
  Schema --> Validator[Validator at runtime]
  Schema --> Tests[Vitest tests]
```

This means:

1. When you change `ReportSchema`, the agent prompt should be updated to match (but the validator catches it if you forget).
2. When the agent's output drifts (a common LLM problem), validation aborts the pipeline before broken data hits `_site/`.
3. Vitest tests assert that real fixture data passes the schema, catching schema-vs-reality drift on every commit.

**The passthrough trade-off**: `ReportSchema` and `MemorySchema` use `.passthrough()` at their top level and make most sub-fields optional. This is deliberate — an LLM's output shape naturally drifts with prompt iteration, and a strict schema would reject valid-looking reports for cosmetic reasons. The templates handle missing fields as empty renders rather than crashes.

## Agent prompt as the design surface

The agent prompt at `.claude/agents/daily-report.md` (~485 lines) is the single biggest lever for output quality on this project, and it's designed around a specific philosophy: **outcome-oriented prompting**, not mechanism-prescriptive rule-listing.

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

- `bash scripts/run.sh --skip-push` — runs Stage 1 + Stage 2 without pushing, useful for end-to-end validation of a prompt change.
- `bash scripts/run.sh --analyze` — runs Stage 2 only (reuses existing staging data), useful for rapid prompt iteration without re-fetching sources. The inner loop is ~2-3 minutes per prompt tweak.

The agent prompt (`.claude/agents/daily-report.md`) is read fresh on every invocation, so editing the prompt doesn't require a rebuild.

**The convergence bar**: "would I personally want to read this report if I wasn't the one writing it?" Three iteration rounds (v1-initial → v2-audience-lock → v3-slug-precision) were needed to reach convergence on the current prompt. The one-shot refactor (giving up the 10-step agent workflow in favour of a single `claude -p` call that reasons through Steps 2-6 internally) was validated against the same convergence bar during the VM migration.

## Fetcher strategy

| Fetcher | Source | Method | Why |
|---|---|---|---|
| `src/fetchers/feeds.js` | RSSHub + native JSON/RSS | fetch + parse | One file handles 15 sources via `config.json` |
| `src/fetchers/github-trending.js` | github.com/trending | cheerio + Octokit enrichment (README excerpts) | HTML scraping is unavoidable, but cheerio is far more robust than regex |
| `src/fetchers/github-search.js` | GitHub Search API | Octokit + `created:>30daysAgo` freshness-first query + README enrichment per result (batched 5 at a time) | Returns genuinely fresh topic-matched repos for the shipped section's **discovery picks** — not "popular-with-CI-activity" heavyweights |
| `src/fetchers/github-developers.js` | GitHub Search Users + Repos APIs | Octokit (batches of 5) + README enrichment | Used to be 273 lines of bash + curl + jq; rewritten to reuse Octokit's built-in throttling and retry |

**HN scoring trick**: RSSHub's `/hackernews/index` doesn't expose scores. We fetch from RSSHub for the front-page list, then enrich each item's `score` and `comments` via `https://hn.algolia.com/api/v1/items/{id}` in parallel batches of 10. See `feeds.js → enrichHNItems`.

**github-search freshness rewrite**: the original query was `topic:X stars:>50 pushed:>yesterday`. In 2026, this returned the same long-lived heavyweights every day (langchain 132k★, ShareX from 2013, etc.) because every popular repo has nightly CI commits matching "pushed yesterday". The agent correctly refused to put langchain in "今日上線", so the fetcher was contributing 0 items to shipped. Query rewritten to `topic:X stars:>100 created:>30daysAgo` + README excerpt enrichment + higher per-topic limit (5 → 10). The result: the shipped section now gets 3–5 discovery picks per report from repos that haven't reached HN / Trending yet, which is the only way to differentiate the brief from "today's HN front page + github trending".

## Memory model

`data/memory.json` is a simple JSON file (not a database) because the dataset is small:

- `short_term` — 7-day rolling window of featured repos, observations, threads
- `long_term` — items promoted from short_term after being referenced 2+ times; pruned at 30 days
- `topics` — frequency map: `{ tag, hit_count, first_seen, last_seen }`
- `narrative_arcs` — multi-day patterns: `{ arc_id, title, episodes: [...], status }`
- `predictions` — falsifiable predictions with `status: pending | confirmed | failed`

The agent produces both the report and updated memory in a single `claude -p` session (Steps 8-9 of the agent prompt). Stage 2's `analyze.sh` validates both against Zod schemas before committing.

We considered SQLite and a vector DB (Chroma) but the data doesn't need them. JSON is fine until it grows past ~10 MB (currently ~50 KB).

## Quality tooling

| Tool | Purpose | Why this and not alternatives |
|---|---|---|
| **Biome** | Lint + format JS/JSON | One binary, one config, 10× faster than ESLint+Prettier |
| **Vitest** | Schema smoke tests | Native ESM, native TS, 10× faster than Jest |
| **Zod** | Schema validation | TypeScript-first, single source of truth |
| **Octokit** | GitHub API client | Bundles `@octokit/plugin-throttling` and `@octokit/plugin-retry` by default |
| **cheerio** | HTML parsing | Used in `github-trending.js` to replace a regex-based scraper |
| **11ty** | Static site build | Mature, fast, ESM-native, no React/Vue overhead for content sites |

## Deploy

GitHub Pages source: **GitHub Actions** (`build_type: workflow`).

The legacy `gh-pages` branch is no longer used. Build runs in CI via `actions/deploy-pages@v4`, which:

1. Builds `_site/` in a clean Ubuntu runner
2. Uploads as a Pages artifact (signed via OIDC)
3. Deploys atomically (no force-push, no orphan commits)

## Scheduled deployment via systemd timer

The production pipeline runs on a Google Cloud **e2-micro** VM (always-free tier) via a systemd timer. The VM hosts other services; the report pipeline is containerized so it cannot impact those.

**One-time setup** (handled by `scripts/setup-vm.sh`, idempotent):

| Step | Why |
|---|---|
| Install Docker Engine | Chosen over host-native install for memory isolation (`--memory=600m`) and clean reproducibility |
| Create 2GB swap at `/swapfile` | e2-micro has limited RAM shared with existing services; LLM synthesis peaks need headroom or OOM-kill risks collateral damage |
| `git clone` the repo to `~/ai-daily-report` | Host-side copy isn't required for runs (the container re-clones into its own volume) but convenient for operators who want to inspect code |
| `docker build -t ai-daily-report:latest` | Builds the image from `Dockerfile`: node:22-slim + git + tini + `@anthropic-ai/claude-code` globally installed |
| Claude Code OAuth (one time, interactive) | Run `claude /login` inside a throwaway container with `-v ~/.claude:/home/pipeline/.claude`; credentials land on the host and persist via bind mount |
| Write `~/.ai-daily-report.env` with `GITHUB_TOKEN=ghp_...` | Loaded by `scripts/cron-run.sh` at invocation time; `chmod 600` to protect the PAT |
| Install systemd timer unit | `ai-daily-report.timer` with `OnCalendar=*-*-* 04:00:00` (Asia/Taipei) and `Persistent=true` so missed runs (e.g., after a VM reboot) are caught up automatically |

**systemd timer:**

The timer unit (`ai-daily-report.timer`) fires `ai-daily-report.service`, which invokes `scripts/cron-run.sh`. `Persistent=true` ensures that if the VM was down at 04:00, the run triggers as soon as the machine comes back up. Logs are captured via `journalctl -u ai-daily-report`.

**`scripts/cron-run.sh` responsibilities:**

1. Source `~/.ai-daily-report.env` to get `GITHUB_TOKEN`
2. Ensure the `ai-daily-report-workspace` named volume exists
3. `docker run --rm --memory=600m --memory-swap=1g --cpus=2 -v workspace -v ~/.claude -e GITHUB_TOKEN ai-daily-report:latest`
4. Log dated banners before/after so log tails are readable

**Inside the container** (`scripts/docker-entrypoint.sh`, invoked by the Dockerfile's ENTRYPOINT via `tini`):

1. If `/workspace` is empty, `git clone https://x-access-token:$GITHUB_TOKEN@github.com/bolin8017/ai-daily-report.git .`
2. Otherwise `git fetch origin main && git reset --hard origin/main` (fresh state every run)
3. Run `npm ci --omit=dev --prefer-offline` only if `package-lock.json` changed since last install (marker file in `node_modules/.package-lock.json`)
4. Run **Stage 1** (`node src/collect.js`) — collect and stage data
5. Run **Stage 2** (`scripts/analyze.sh`) — synthesize report via `claude -p`

**Two-stage pipeline lifecycle:**

**Stage 1 — Collect** (deterministic Node process, `src/collect.js`):

1. Compute today's date in `Asia/Taipei`
2. `runFetchers()` — `Promise.all([fetchFeeds, fetchTrending, fetchSearch, fetchDevelopers])`; tolerate 1-of-4 degraded
3. `buildSnapshot(raw.feeds)` — writes `data/feeds-snapshot.json` for 11ty
4. `condenseAll(raw)` — 4 × ≤8500-token objects for prompt-size control
5. Write condensed data to `data/staging/`
6. `commitAndPush()` — stages and pushes staging data so it's available for Stage 2

**Stage 2 — Analyze** (agent session, `scripts/analyze.sh`):

1. Assemble the prompt from `.claude/agents/daily-report.md` + `.claude/daily-report-quality.md` + memory context
2. Invoke `claude -p --allowedTools Read,Write --model claude-opus-4-6` — the agent reads staging files via the Read tool, synthesizes the report, and writes `data/reports/YYYY-MM-DD.json` + `data/memory.json` directly via the Write tool
3. Validate outputs: `ReportSchema.parse(report)`, `MemorySchema.parse(memory)`
4. `commitAndPush({ date })` — stages the report and memory files, commits as `report: <date> daily creative brief`, pushes to `HEAD:main` using `x-access-token:$GITHUB_TOKEN` URL rewrite
5. GHA's daily 21:00 UTC cron hydrates `data/` from the `data` branch and deploys to Pages. The cron is independent of the Stage 2 push — the `data` orphan has no `.github/workflows/` tree, so pushes there cannot themselves fire the workflow.

**Why systemd timer instead of GitHub Actions `schedule:`:** GHA schedules run on hosted runners without Claude Code subscription auth, forcing you onto `ANTHROPIC_API_KEY` (paid, defeats the Max advantage) or OAuth secret juggling. A VM with a one-time interactive `claude /login` sidesteps both — the login token persists in `~/.claude` and every subsequent timer invocation just works.

**Memory budget**: e2-micro has limited RAM shared with other services. Synthesis peaks (~500-700MB for fetchers + claude CLI context) pushed into the 2GB swapfile absorb the burst without OOM. `docker run --memory=600m --memory-swap=1g` caps the container so a runaway can never hurt the host.

## Trade-offs and known issues

| Issue | Impact | Mitigation |
|---|---|---|
| **GitHub Trending HTML can change** | github-trending fetcher returns 0 repos | cheerio is more resilient than regex; `runFetchers` tolerates 1 of 4 degraded; schema validator catches empty report and aborts the deploy |
| **External RSSHub dependency** (`rsshub.pseudoyu.com`, `rsshub.rssforever.com`) | Multiple feeds can time out together if a shared instance is slow | `config.json → sources.rsshub_urls` is an ordered list. `feeds.js` tries each URL per request, falling through on any error (timeout, 5xx, network) — so when one instance is down, the next request gets the same route from the backup. `runFetchers` additionally tolerates 1-of-4 fetcher failure at the outer level. Self-hosting RSSHub was rejected as VM maintenance burden for a once-a-day read. |
| **HN Algolia API is undocumented** | Score enrichment may break | Wrapped in try/catch; missing scores degrade report quality but don't break the pipeline |
| **LLM synthesis is the quality single point of failure** | Schema-invalid output blocks the day | The agent writes files directly via the Write tool (no JSON extraction from stdout needed); Zod validation in `analyze.sh` aborts the run before commit. Yesterday's report stays live. |
| **VM / Docker / systemd timer failure** | Report missed for the day | systemd timer's `Persistent=true` catches up missed runs after a reboot. `OnFailure=` unit can trigger alerting. `journalctl -u ai-daily-report` is the first place to look; `bash scripts/cron-run.sh` can be re-invoked manually. Host uptime is responsibility of the VM operator. |
| **Claude subscription token expires** | `claude -p` calls start failing | `~/.claude` needs to be re-authed; pipeline fails loudly rather than silently degrading. Re-run `claude /login` in a throwaway container. |

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
