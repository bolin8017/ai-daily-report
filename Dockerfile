# Minimal runtime image for the daily report pipeline.
#
# The image contains only Node.js, git, and the Claude Code CLI. No project
# code is baked in — the pipeline clones the repo into a persistent /workspace
# volume at runtime so `git pull` updates flow without rebuilding the image.
#
# Claude Code auth state (~/.claude) is expected as a read-write bind-mount
# so the CLI can refresh its OAuth token before expiry. A read-only mount
# deadlocks the pipeline — see commit faea48e for the failure mode.

# Pinned to digest for supply-chain immutability. Dependabot (see
# .github/dependabot.yml) opens PRs to refresh the digest weekly.
FROM node:22-slim@sha256:f3a68cf41a855d227d1b0ab832bed9749469ef38cf4f58182fb8c893bc462383

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git \
       ca-certificates \
       tini \
       gosu \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --no-progress --no-audit --no-fund @anthropic-ai/claude-code@2.1.104 \
  && claude --version

# Non-root user for defense-in-depth. The entrypoint starts as root to fix
# volume ownership (migration from older root-based images), then drops to
# this user via gosu before running any pipeline code.
RUN useradd -r -m -s /bin/bash pipeline \
  && mkdir -p /workspace \
  && chown pipeline:pipeline /workspace

# Workspace holds the cloned repo + node_modules between runs. Mounted as a
# Docker named volume in production so git/npm state persists across invocations.
VOLUME ["/workspace"]
WORKDIR /workspace

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# tini reaps orphaned child processes (claude spawns subprocesses for SSE streams)
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
