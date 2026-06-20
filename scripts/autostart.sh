#!/usr/bin/env sh
set -eu

LABEL="${CODEX_WEB_ASSISTANT_LAUNCHD_LABEL:-com.vicksiyi.chrome-codex-tools.bridge}"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/chrome-codex-tools"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
COMMAND="${1:-install}"

if [ -z "$NODE_BIN" ] && [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
  NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
fi

domain() {
  printf 'gui/%s' "$(id -u)"
}

xml_escape() {
  printf '%s' "$1" | sed \
    -e 's/&/\&amp;/g' \
    -e 's/</\&lt;/g' \
    -e 's/>/\&gt;/g'
}

write_plist() {
  if [ -z "$NODE_BIN" ]; then
    printf 'Node.js was not found. Set NODE_BIN=/absolute/path/to/node and retry.\n' >&2
    exit 1
  fi

  mkdir -p "$PLIST_DIR" "$LOG_DIR"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$LABEL")</string>

  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>$(xml_escape "$ROOT_DIR/local-codex-bridge/server.ts")</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT_DIR")</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CODEX_WEB_ASSISTANT_HOST</key>
    <string>$(xml_escape "${CODEX_WEB_ASSISTANT_HOST:-127.0.0.1}")</string>
    <key>CODEX_WEB_ASSISTANT_PORT</key>
    <string>$(xml_escape "${CODEX_WEB_ASSISTANT_PORT:-8787}")</string>
    <key>CODEX_WEB_ASSISTANT_TIMEOUT_MS</key>
    <string>$(xml_escape "${CODEX_WEB_ASSISTANT_TIMEOUT_MS:-180000}")</string>
    <key>CODEX_WEB_ASSISTANT_MAX_TEXT</key>
    <string>$(xml_escape "${CODEX_WEB_ASSISTANT_MAX_TEXT:-60000}")</string>
    <key>CODEX_WEB_ASSISTANT_MAX_BODY</key>
    <string>$(xml_escape "${CODEX_WEB_ASSISTANT_MAX_BODY:-900000}")</string>
$(if [ -n "${CODEX_WEB_ASSISTANT_DB_PATH:-}" ]; then printf '    <key>CODEX_WEB_ASSISTANT_DB_PATH</key>\n    <string>%s</string>\n' "$(xml_escape "$CODEX_WEB_ASSISTANT_DB_PATH")"; fi)
$(if [ -n "${CODEX_BIN:-}" ]; then printf '    <key>CODEX_BIN</key>\n    <string>%s</string>\n' "$(xml_escape "$CODEX_BIN")"; fi)
  </dict>

  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG_DIR/bridge.out.log")</string>

  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG_DIR/bridge.err.log")</string>
</dict>
</plist>
EOF
}

unload_agent() {
  if launchctl print "$(domain)/${LABEL}" >/dev/null 2>&1; then
    launchctl bootout "$(domain)" "$PLIST_PATH" >/dev/null 2>&1 || true
  fi
}

install_agent() {
  write_plist
  unload_agent
  launchctl bootstrap "$(domain)" "$PLIST_PATH"
  launchctl kickstart -k "$(domain)/${LABEL}"
  printf 'Installed and started %s\n' "$LABEL"
  printf 'Plist: %s\n' "$PLIST_PATH"
  printf 'Logs:  %s\n' "$LOG_DIR"
}

uninstall_agent() {
  unload_agent
  rm -f "$PLIST_PATH"
  printf 'Uninstalled %s\n' "$LABEL"
}

status_agent() {
  if launchctl print "$(domain)/${LABEL}" >/dev/null 2>&1; then
    launchctl print "$(domain)/${LABEL}"
  else
    printf '%s is not loaded.\n' "$LABEL"
    if [ -f "$PLIST_PATH" ]; then
      printf 'Plist exists at %s but is not loaded.\n' "$PLIST_PATH"
    fi
  fi
}

stop_agent() {
  if launchctl print "$(domain)/${LABEL}" >/dev/null 2>&1; then
    launchctl bootout "$(domain)" "$PLIST_PATH" >/dev/null 2>&1 || true
    printf 'Stopped %s\n' "$LABEL"
  else
    printf '%s is not loaded.\n' "$LABEL"
  fi
}

case "$COMMAND" in
  install)
    install_agent
    ;;
  stop)
    stop_agent
    ;;
  uninstall)
    uninstall_agent
    ;;
  restart)
    install_agent
    ;;
  status)
    status_agent
    ;;
  *)
    printf 'Usage: %s [install|stop|uninstall|restart|status]\n' "$0" >&2
    exit 2
    ;;
esac
