#!/bin/bash
set -euo pipefail

# Only on Claude Code on the web. A local checkout manages its own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# `npm install` rather than `npm ci`: the container is cached once this hook completes, and install
# reuses what is already there instead of deleting node_modules and starting over.
npm install --no-audit --no-fund --prefer-offline

# The browser Playwright needs is preinstalled on the web (PLAYWRIGHT_BROWSERS_PATH), and downloading
# another is blocked. Say so for the whole session, so no install step is tempted.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
fi
