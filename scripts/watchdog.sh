#!/usr/bin/env bash
# Liveness watchdog for long-running subprocesses (claude -p).
#
# Why this exists (honored feedback): wall-clock timeouts are the wrong
# liveness signal for LLM pipelines — claude -p runtime varies widely
# (5 min on a thin day, 45 min+ on a rich one) and a fixed cap either
# kills healthy slow runs or leaves pathological hangs running for hours.
#
# What this watches instead: the child's /proc/$PID/io counters
# (rchar + wchar, aggregated read/write syscall bytes) AND /proc/$PID/stat
# CPU ticks (utime + stime). A process is only declared stuck when BOTH
# signals stagnate simultaneously — a running LLM inference spends most
# of its time blocked on recv() (low CPU, low IO) but does bounce between
# response-chunk arrivals and token processing, so combined monitoring
# avoids false kills during legitimate slow periods.
#
# Usage:
#   scripts/watchdog.sh <pid>
#
# Environment:
#   WATCHDOG_CHECK_INTERVAL_SEC   — poll interval (default 60s)
#   WATCHDOG_STAGNANT_MINUTES     — kill threshold (default 15)
#
# Exit codes:
#   0   — monitored PID exited on its own (normal)
#   124 — monitored PID was killed for liveness failure (matches GNU timeout)

set -euo pipefail

CLAUDE_PID="${1:?usage: watchdog.sh <pid>}"
CHECK_INTERVAL_SEC="${WATCHDOG_CHECK_INTERVAL_SEC:-60}"
STAGNANT_MINUTES="${WATCHDOG_STAGNANT_MINUTES:-15}"
STAGNANT_MAX_CHECKS=$(( STAGNANT_MINUTES * 60 / CHECK_INTERVAL_SEC ))

log() { echo "[watchdog] $*" >&2; }

# Sum rchar + wchar from /proc/$PID/io. These count bytes that went
# through read/write syscalls — no SSE chunk, no tool result, nothing
# moves without bumping these.
io_bytes() {
  local pid="$1"
  if [ ! -r "/proc/$pid/io" ]; then
    echo "0"
    return
  fi
  awk '/^rchar:|^wchar:/ { sum += $2 } END { print sum + 0 }' "/proc/$pid/io" 2>/dev/null || echo "0"
}

# Sum utime + stime ticks from /proc/$PID/stat (fields 14 and 15).
cpu_ticks() {
  local pid="$1"
  if [ ! -r "/proc/$pid/stat" ]; then
    echo "0"
    return
  fi
  # /proc/$pid/stat fields are space-separated; fields 14 = utime, 15 = stime.
  # The comm field (field 2) can contain spaces inside parens, so strip the
  # parenthesized segment before splitting.
  local stat
  stat=$(cat "/proc/$pid/stat" 2>/dev/null) || { echo "0"; return; }
  # Remove the parenthesized comm field, then sum fields 12+13 of the remainder
  # (which correspond to the original fields 14+15 after removing pid + comm).
  local tail_fields="${stat#*) }"
  awk '{ print $12 + $13 }' <<< "$tail_fields"
}

log "pid=$CLAUDE_PID monitoring (poll=${CHECK_INTERVAL_SEC}s, kill after ${STAGNANT_MINUTES}m of zero IO AND zero CPU progress)"

prev_io=$(io_bytes "$CLAUDE_PID")
prev_cpu=$(cpu_ticks "$CLAUDE_PID")
stagnant_checks=0

while kill -0 "$CLAUDE_PID" 2>/dev/null; do
  sleep "$CHECK_INTERVAL_SEC"

  curr_io=$(io_bytes "$CLAUDE_PID")
  curr_cpu=$(cpu_ticks "$CLAUDE_PID")

  if [ "$curr_io" = "$prev_io" ] && [ "$curr_cpu" = "$prev_cpu" ]; then
    stagnant_checks=$(( stagnant_checks + 1 ))
    log "pid=$CLAUDE_PID no IO and no CPU progress (${stagnant_checks}/${STAGNANT_MAX_CHECKS} stagnant checks)"

    if [ "$stagnant_checks" -ge "$STAGNANT_MAX_CHECKS" ]; then
      log "pid=$CLAUDE_PID stagnant for ${STAGNANT_MINUTES}m — sending SIGTERM"
      kill -TERM "$CLAUDE_PID" 2>/dev/null || true
      # Grace period for clean shutdown, then SIGKILL
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        sleep 1
        kill -0 "$CLAUDE_PID" 2>/dev/null || break
      done
      if kill -0 "$CLAUDE_PID" 2>/dev/null; then
        log "pid=$CLAUDE_PID did not exit after SIGTERM — sending SIGKILL"
        kill -KILL "$CLAUDE_PID" 2>/dev/null || true
      fi
      exit 124
    fi
  else
    if [ "$stagnant_checks" -gt 0 ]; then
      log "pid=$CLAUDE_PID progress resumed — resetting stagnant counter"
    fi
    stagnant_checks=0
    prev_io="$curr_io"
    prev_cpu="$curr_cpu"
  fi
done

log "pid=$CLAUDE_PID exited on its own"
exit 0
