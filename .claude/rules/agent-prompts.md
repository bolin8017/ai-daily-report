---
paths:
  - ".claude/agents/*.md"
  - ".claude/daily-report-quality.md"
---

# Agent prompt editing rules

## These files are the quality lever

`.claude/agents/daily-report.md` (~485 lines) and `.claude/daily-report-quality.md` are the core prompts that drive the LLM-produced daily report. Changes here directly affect report quality, schema compliance, and voice.

## How they are consumed

`scripts/analyze.sh` concatenates them at runtime:
1. `.claude/agents/daily-report.md` (workflow steps, section definitions, schema references)
2. `.claude/daily-report-quality.md` (voice rules, slop test, anti-patterns, Chinese translation-smell checklist)
3. Today's date injected at the end

The concatenated prompt is piped to `claude -p` with `--allowedTools Read Write Grep Glob`. Bash is intentionally excluded — no workflow step needs it, and including it would widen the prompt-injection blast radius.

## When editing prompts

- **Outcome-oriented, not mechanism-prescriptive**: describe the reader persona and show good/bad examples rather than hard count/length rules
- Keep the audience lock: the reader is an **AI engineer who builds** (RAG/VLM/fine-tuning/agent/MCP), not a decision-maker
- Section descriptions say **what question the section answers**, not how many items or words to write
- Schema is the contract: if the prompt and schema disagree about a field, schema wins. Update the schema first if you need a new field
- After prompt changes, run a `--skip-push` pipeline to verify the agent still produces schema-valid output
- The prompt was calibrated against 4 external reviewers; avoid removing constraints without understanding why they were added
