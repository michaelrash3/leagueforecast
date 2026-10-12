#!/bin/bash
set -euo pipefail

# Only on Claude Code on the web. A local checkout manages its own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# `npm install` rather than `npm ci`: the container is cached once this hook completes, and install
# reuses what is already there instead of deleting node_modules and starting over. `--no-save` leaves
# package-lock.json as committed: a lockfile written by a newer npm (the dependency update of 28
# September 2026) records a `libc` field on platform packages that this container's npm drops when
# it writes one back, which left every session start with an 18-line change nobody made.
npm install --no-audit --no-fund --prefer-offline --no-save

# The browser Playwright needs is preinstalled on the web (PLAYWRIGHT_BROWSERS_PATH), and downloading
# another is blocked. Say so for the whole session, so no install step is tempted.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"
fi
