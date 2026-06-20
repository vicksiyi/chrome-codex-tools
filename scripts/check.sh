#!/usr/bin/env sh
set -eu

node --check local-codex-bridge/server.js
node --check extension/background.js
node --check extension/content.js
node --check extension/popup.js
