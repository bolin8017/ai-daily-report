# Minimal runtime image for the daily report pipeline.
#
# The image contains only Node.js, git, and the Claude Code CLI. No project
# code is baked in — the pipeline clones the repo into a persistent /workspace
# volume at runtime so `git pull` updates flow without rebuilding the image.
#
# Claude Code auth state (~/.claude) is expected as a bind-mount at /root/.claude.

FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       git \
       ca-certificates \
       tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --no-progress --no-audit --no-fund @anthropic-ai/claude-code \
  && claude --version

# Workspace holds the cloned repo + node_modules between runs. Mounted as a
# Docker named volume in production so git/npm state persists across invocations.
VOLUME ["/workspace"]
VOLUME ["/root/.claude"]
WORKDIR /workspace

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# tini reaps orphaned child processes (claude spawns subprocesses for SSE streams)
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
