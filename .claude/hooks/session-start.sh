#!/bin/bash
set -euo pipefail

# Only on Claude Code on the web. A local checkout manages its own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# The Node `.nvmrc` pins, which CI and the deployment run. The web image carries more than one Node
# under /opt and puts 22 first on PATH, so a session ran its gate on 22.23 while CI ran the same
# gate on 24.22 (both read on 6 November 2026). The pinned one goes first for this hook's install
# and, through the env file, for every command the session runs after it. An image without that
# Node keeps its own and says which.
node_major="$(head -n 1 .nvmrc | sed 's/^v//' | cut -d . -f 1 | tr -dc '0-9')"
pinned_node="/opt/node${node_major}/bin"
if [ -x "$pinned_node/node" ]; then
  export PATH="$pinned_node:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$pinned_node:\$PATH\"" >> "$CLAUDE_ENV_FILE"
  fi
else
  echo "Node ${node_major} from .nvmrc is not in this image; the session runs $(node -v)." >&2
fi

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
