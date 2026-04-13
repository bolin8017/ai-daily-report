---
paths:
  - "scripts/*.sh"
  - "systemd/*.service"
  - "systemd/*.timer"
---

# Shell scripts and systemd units

## Bash conventions (observed in this codebase)

- Every script starts with `#!/usr/bin/env bash` and `set -euo pipefail`
- Scripts `cd "$(dirname "$0")/.."` to normalize working directory to repo root
- Load `.env` with the idiomatic pattern: `set -a; source .env; set +a`
- Guard secrets with early `if [ -z "${VAR:-}" ]` checks before any work
- Use `# shellcheck source=/dev/null` above sourced files to suppress SC1090
- Timestamps via `date -Iseconds` (ISO 8601), not epoch or custom formats
- Logging prefix convention: `[script-name]` (e.g., `[cron-run]`, `[analyze]`, `[entrypoint]`)
- Quote all variable expansions: `"$VAR"`, `"${VAR:-default}"`

## systemd unit conventions

- Template variables use `__PLACEHOLDER__` (double underscores): `__USER__`, `__REPO_DIR__`, `__HOME__`
- `scripts/setup-vm.sh` substitutes placeholders with `sed -e "s|__X__|${X}|g"` and writes to `/etc/systemd/system/`
- The timer fires at UTC time equivalent to 04:00 Asia/Taipei (currently 20:00 UTC)
- `Persistent=true` ensures catch-up after missed triggers

## When editing scripts

- Keep scripts idempotent (safe to re-run)
- Test Docker-related commands with `docker info >/dev/null 2>&1` before use
- Use `exec` for the final command in entrypoints (replaces shell PID with child)
- Pipeline modes (`collect`, `analyze`, `both`) are case-matched in docker-entrypoint.sh -- keep in sync with run.sh
