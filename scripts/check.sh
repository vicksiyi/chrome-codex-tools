#!/usr/bin/env sh
set -eu

node -e "import('./local-codex-bridge/server.ts')"
node --check extension/background.js
node --check extension/content.js
node --check extension/popup.js
node --check extension/debug.js
sh -n scripts/stop.sh
node --test test/*.test.ts
