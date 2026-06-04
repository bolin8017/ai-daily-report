---
paths:
  - "scripts/*.sh"
---

# Shell scripts

## Bash conventions (observed in this codebase)

- Every script starts with `#!/usr/bin/env bash` and `set -euo pipefail`
- Scripts `cd "$(dirname "$0")/.."` to normalize working directory to repo root
- Load `.env` with the idiomatic pattern: `set -a; source .env; set +a`
- Guard secrets with early `if [ -z "${VAR:-}" ]` checks before any work
- Use `# shellcheck source=/dev/null` above sourced files to suppress SC1090
- Timestamps via `date -Iseconds` (ISO 8601), not epoch or custom formats
- Logging prefix convention: `[script-name]` (e.g., `[analyze]`, `[curate]`, `[synthesize]`)
- Quote all variable expansions: `"$VAR"`, `"${VAR:-default}"`

## When editing scripts

- Keep scripts idempotent (safe to re-run)
- The pipeline stages (collect → curate → synthesize → merge) are invoked in
  sequence by the `src/pipeline/run.js` sequencer (invoked from `scripts/run.sh`); keep stage/mode names in sync with
  `scripts/run.sh`
