#!/bin/bash
# Installs dependencies in Claude Code cloud sessions so tests can run right away.
set -euo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "$CLAUDE_PROJECT_DIR"
npm install --no-audit --no-fund
