# Contributing

Thanks for your interest. This is a personal project so PRs are not actively reviewed, but if you have an improvement, open an issue first to discuss.

Production scheduled runs live on Anthropic Cloud Runtime — see [ARCHITECTURE.md § Scheduled deployment via CCR](./ARCHITECTURE.md#scheduled-deployment-via-ccr). The setup below is only for local iteration on prompts, fetchers, schemas, or templates.

## Setup

```bash
git clone https://github.com/bolin8017/ai-daily-report.git
cd ai-daily-report
npm ci
cp .env.example .env       # set GITHUB_TOKEN
claude                     # one-time login (then /login in REPL)
```

RSSHub is accessed via the public community instance `https://rsshub.pseudoyu.com` (configured in `config.json`, override with `RSSHUB_URL` env var if needed). No self-hosting required.

See [README.md](./README.md) for the full local-dev overview.

## Development

```bash
npm test                 # vitest schema tests
npm run lint             # biome check
npm run format           # biome format --write
npm run validate:report  # validate latest data/reports/YYYY-MM-DD.json against schema

npm start                # full pipeline (fetch → agent → push)
npm run build            # rebuild docs/ from latest data/reports/YYYY-MM-DD.json
npm run serve            # 11ty dev server with live reload
```

## Making changes

- **Conventional commits**: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`.
- **Schema-first**: when changing `data/reports/YYYY-MM-DD.json` shape, update `src/schemas/report.js` first, then the agent prompt at `.claude/agents/daily-report.md`, then the templates under `site/`.
- **Test before pushing**: `npm test && npm run lint`.
- **Keep CLAUDE.md current**: it's the runbook for the agent and for human collaborators.

## Where editorial quality comes from

Code changes affect data plumbing. **Editorial quality comes almost entirely from the agent prompt** (`.claude/agents/daily-report.md`, ~485 lines). If a published report reads like AI slop, the fix is usually in the prompt's Step 6 (editorial writing) or Step 7 (self-check), not in the fetchers or templates.

The prompt is **outcome-oriented** (describes what good output looks like + gives positive examples) rather than **mechanism-prescriptive** (hard count / length rules). See [ARCHITECTURE.md § Agent prompt as the design surface](./ARCHITECTURE.md#agent-prompt-as-the-design-surface) for the design philosophy and the external review methodology that calibrated it.

### Iterating on the prompt locally

Prompt changes can be validated without running the full pipeline or touching GitHub:

```bash
# 1. Keep the most recent tmp/*.json around (don't run another npm start,
#    which would wipe tmp/ at Phase 1).

# 2. Backup current state as the baseline for diffing
mkdir -p /tmp/prompt-iter
cp data/reports/$(date +%Y-%m-%d).json /tmp/prompt-iter/report-baseline.json
cp data/memory.json /tmp/prompt-iter/memory-baseline.json

# 3. Edit .claude/agents/daily-report.md

# 4. Run the agent directly against cached tmp/ (no fetch, no push, no CI)
cp /tmp/prompt-iter/memory-baseline.json data/memory.json  # reset memory
cp /tmp/prompt-iter/report-baseline.json data/reports/$(date +%Y-%m-%d).json  # force regenerate
claude --agent daily-report --dangerously-skip-permissions \
  -p "Execute the full daily report workflow for $(date +%Y-%m-%d) (Steps 1-10 in .claude/agents/daily-report.md). Fetched data is already in tmp/ — Step 1 reads it directly, skip any fetch. Output the final report to data/reports/$(date +%Y-%m-%d).json and update data/memory.json. Do NOT run git commands."

# 5. Validate + compare
node src/lib/validate.js report data/reports/$(date +%Y-%m-%d).json
node src/lib/validate.js memory data/memory.json
jq '.lead.html | length, (.shipped | length), (.ideas | length), (.predictions | length)' data/reports/$(date +%Y-%m-%d).json

# 6. Repeat from step 3 until converged
```

The convergence bar is **"would I personally want to read this report if I wasn't the writer?"** — err toward stricter rather than looser.

## Adding a data source

1. Add an entry to `config.json` under `sources.feeds[]`.
2. Verify it's software/AI-related (see existing sources for the curation bar — it leans technical and builder-oriented, not general tech news).
3. Test the fetch: `node src/fetchers/feeds.js > /tmp/check.json && jq '.feeds_ok' /tmp/check.json`.
4. Run `npm start` end-to-end to verify the agent can use it.
5. If the source represents a new **category** the agent should cite (e.g., a new AI lab's newsroom, or a new community forum), also update the **Inputs** section of `.claude/agents/daily-report.md` so the agent knows the source exists.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design rationale and trade-offs.
