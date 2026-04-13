#!/usr/bin/env bash
# One-time VM setup for running the ai-daily-report pipeline.
#
# Safe to re-run: every step is idempotent. Walks the operator through:
#
#   1. Install Docker (if missing) and verify the daemon
#   2. Add 2GB swap (required because the VM has limited RAM and runs other
#      services; LLM synthesis peaks need headroom to avoid OOM)
#   3. Clone the repo and build the Docker image
#   4. Install systemd timer for daily 04:00 Asia/Taipei execution
#   5. Print instructions for Claude CLI OAuth and secrets
#
# Usage on the VM:
#   curl -fsSL https://raw.githubusercontent.com/bolin8017/ai-daily-report/main/scripts/setup-vm.sh | bash
# or if already cloned:
#   bash scripts/setup-vm.sh

set -euo pipefail

REPO_URL="https://github.com/bolin8017/ai-daily-report.git"
REPO_DIR="${HOME}/ai-daily-report"
IMAGE="ai-daily-report:latest"
SWAP_SIZE="2G"
SWAP_FILE="/swapfile"
UNIT_DIR="/etc/systemd/system"

log() { echo "[setup-vm] $*"; }
err() { echo "[setup-vm] ERROR: $*" >&2; }

# ──────────────────────────────────────────────────────────────
# Step 1: Docker
# ──────────────────────────────────────────────────────────────
step_docker() {
  if command -v docker >/dev/null 2>&1; then
    log "docker already installed: $(docker --version)"
  else
    log "installing Docker via convenience script..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker "$USER"
    log "NOTE: log out and log back in to pick up the docker group, then re-run this script"
    exit 0
  fi

  if ! docker info >/dev/null 2>&1; then
    err "docker daemon not reachable — try: sudo systemctl start docker"
    exit 1
  fi
  log "docker daemon ok"
}

# ──────────────────────────────────────────────────────────────
# Step 2: Swap
# ──────────────────────────────────────────────────────────────
step_swap() {
  if [ "$(swapon --show | wc -l)" -gt 0 ]; then
    log "swap already configured:"
    swapon --show | sed 's/^/  /'
    return
  fi
  log "creating ${SWAP_SIZE} swap at ${SWAP_FILE}..."
  sudo fallocate -l "$SWAP_SIZE" "$SWAP_FILE"
  sudo chmod 600 "$SWAP_FILE"
  sudo mkswap "$SWAP_FILE"
  sudo swapon "$SWAP_FILE"
  if ! grep -q "$SWAP_FILE" /etc/fstab; then
    echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab
  fi
  log "swap enabled"
}

# ──────────────────────────────────────────────────────────────
# Step 3: Repo + image
# ──────────────────────────────────────────────────────────────
step_repo() {
  if [ -d "$REPO_DIR/.git" ]; then
    log "repo already cloned at ${REPO_DIR}, pulling latest main..."
    git -C "$REPO_DIR" fetch origin main --quiet
    git -C "$REPO_DIR" reset --hard origin/main
  else
    log "cloning ${REPO_URL} into ${REPO_DIR}..."
    git clone "$REPO_URL" "$REPO_DIR"
  fi
}

step_image() {
  log "building docker image ${IMAGE}..."
  docker build -t "$IMAGE" "$REPO_DIR"
  log "image built: $(docker images --format '{{.Repository}}:{{.Tag}} {{.Size}}' "$IMAGE")"
}

# ──────────────────────────────────────────────────────────────
# Step 4: systemd timer (replaces crontab)
# ──────────────────────────────────────────────────────────────
step_systemd() {
  log "installing systemd units..."

  # Generate service file from template (substitute __USER__ and __REPO_DIR__)
  sed -e "s|__USER__|${USER}|g" -e "s|__REPO_DIR__|${REPO_DIR}|g" \
    "$REPO_DIR/systemd/ai-daily-report.service" \
    | sudo tee "$UNIT_DIR/ai-daily-report.service" > /dev/null

  # Timer has no user-specific placeholders
  sudo cp "$REPO_DIR/systemd/ai-daily-report.timer" "$UNIT_DIR/ai-daily-report.timer"

  # Failure notification service (template unit)
  sed -e "s|__USER__|${USER}|g" -e "s|__HOME__|${HOME}|g" \
    "$REPO_DIR/systemd/ai-daily-report-notify@.service" \
    | sudo tee "$UNIT_DIR/ai-daily-report-notify@.service" > /dev/null

  sudo systemctl daemon-reload
  sudo systemctl enable ai-daily-report.timer
  sudo systemctl start ai-daily-report.timer

  log "timer status: $(systemctl is-active ai-daily-report.timer)"
  log "next trigger:"
  systemctl list-timers ai-daily-report.timer --no-pager | sed 's/^/  /'

  # Remove old crontab entry if it exists
  if crontab -l 2>/dev/null | grep -q 'cron-run.sh'; then
    log "removing old crontab entry..."
    crontab -l | grep -v 'cron-run.sh' | grep -v 'TZ=Asia/Taipei' | crontab -
    log "old crontab entry removed"
  fi
}

# ──────────────────────────────────────────────────────────────
# Step 5: operator instructions
# ──────────────────────────────────────────────────────────────
print_next_steps() {
  cat <<EOF

[setup-vm] ✓ setup complete

Remaining manual steps:

1. CLAUDE CLI AUTH (one-time)
   The pipeline uses the Claude Max subscription via \`claude -p\`. On this
   headless VM you need to authenticate once:

     # from your local machine, SSH with port forwarding:
     gcloud compute ssh <INSTANCE_NAME> --zone=<ZONE> -- -L 9999:localhost:9999

     # on the VM:
     docker run --rm -it \\
       -v "\$HOME/.claude":/home/pipeline/.claude \\
       -p 9999:9999 \\
       ai-daily-report:latest \\
       bash -c "claude /login"

   Follow the printed URL in your local browser; paste the auth code back
   when prompted. The credentials land in ~/.claude on the VM.

2. SECRETS FILE
   Create ~/.ai-daily-report.env with:

     GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxx

   (PAT needs Contents: read/write scope on the ai-daily-report repo.)

     chmod 600 ~/.ai-daily-report.env

3. MANUAL DRY RUN
   Test once end-to-end before relying on the timer:

     sudo systemctl start ai-daily-report.service
     journalctl -u ai-daily-report -f

   Watch for a new commit on origin/main and a green GitHub Actions build.

4. VERIFY TIMER
   The systemd timer is already enabled and will fire daily at 04:00 Asia/Taipei.
   Check status with:

     systemctl list-timers ai-daily-report.timer
     journalctl -u ai-daily-report --since today

   If the VM reboots and misses 04:00, the timer catches up automatically
   (Persistent=true).

EOF
}

main() {
  step_docker
  step_swap
  step_repo
  step_image
  step_systemd
  print_next_steps
}

main "$@"
