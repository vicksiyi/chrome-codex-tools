#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVER_PATH="${ROOT_DIR}/local-codex-bridge/server.ts"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
COMMAND="${1:-start}"

if [ -z "$NODE_BIN" ] && [ -x "/Applications/Codex.app/Contents/Resources/node" ]; then
  NODE_BIN="/Applications/Codex.app/Contents/Resources/node"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  DEFAULT_LOG_DIR="${HOME}/Library/Logs/chrome-codex-tools"
else
  DEFAULT_LOG_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/chrome-codex-tools/logs"
fi

STATE_DIR="${CODEX_WEB_ASSISTANT_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/chrome-codex-tools}"
LOG_DIR="${CODEX_WEB_ASSISTANT_LOG_DIR:-$DEFAULT_LOG_DIR}"
PID_FILE="${STATE_DIR}/bridge.pid"
OUT_LOG="${LOG_DIR}/bridge.out.log"
ERR_LOG="${LOG_DIR}/bridge.err.log"

is_running() {
  [ -f "$PID_FILE" ] || return 1

  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1

  kill -0 "$pid" >/dev/null 2>&1 || return 1
}

start_daemon() {
  if [ -z "$NODE_BIN" ]; then
    printf 'Node.js was not found. Set NODE_BIN=/absolute/path/to/node and retry.\n' >&2
    exit 1
  fi

  if is_running; then
    printf 'Codex Web Assistant bridge is already running. PID: %s\n' "$(cat "$PID_FILE")"
    return
  fi

  mkdir -p "$STATE_DIR" "$LOG_DIR"

  nohup env \
    PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}" \
    CODEX_BIN="${CODEX_BIN:-}" \
    CODEX_WEB_ASSISTANT_HOST="${CODEX_WEB_ASSISTANT_HOST:-127.0.0.1}" \
    CODEX_WEB_ASSISTANT_PORT="${CODEX_WEB_ASSISTANT_PORT:-8787}" \
    CODEX_WEB_ASSISTANT_TIMEOUT_MS="${CODEX_WEB_ASSISTANT_TIMEOUT_MS:-180000}" \
    CODEX_WEB_ASSISTANT_MAX_TEXT="${CODEX_WEB_ASSISTANT_MAX_TEXT:-60000}" \
    CODEX_WEB_ASSISTANT_MAX_BODY="${CODEX_WEB_ASSISTANT_MAX_BODY:-900000}" \
    CODEX_WEB_ASSISTANT_DB_PATH="${CODEX_WEB_ASSISTANT_DB_PATH:-}" \
    "$NODE_BIN" "$SERVER_PATH" >>"$OUT_LOG" 2>>"$ERR_LOG" &

  pid="$!"
  printf '%s\n' "$pid" > "$PID_FILE"
  sleep 1

  if is_running; then
    printf 'Started Codex Web Assistant bridge. PID: %s\n' "$pid"
    printf 'Logs: %s\n' "$LOG_DIR"
  else
    rm -f "$PID_FILE"
    printf 'Failed to start Codex Web Assistant bridge.\n' >&2
    tail -n 40 "$ERR_LOG" >&2 2>/dev/null || true
    exit 1
  fi
}

stop_daemon() {
  if ! is_running; then
    rm -f "$PID_FILE"
    printf 'Codex Web Assistant bridge is not running.\n'
    return
  fi

  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true

  attempts=0
  while kill -0 "$pid" >/dev/null 2>&1 && [ "$attempts" -lt 10 ]; do
    attempts=$((attempts + 1))
    sleep 1
  done

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -KILL "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$PID_FILE"
  printf 'Stopped Codex Web Assistant bridge.\n'
}

status_daemon() {
  if is_running; then
    printf 'Codex Web Assistant bridge is running. PID: %s\n' "$(cat "$PID_FILE")"
    printf 'PID file: %s\n' "$PID_FILE"
    printf 'Logs: %s\n' "$LOG_DIR"
  else
    rm -f "$PID_FILE"
    printf 'Codex Web Assistant bridge is not running.\n'
  fi
}

tail_logs() {
  mkdir -p "$LOG_DIR"
  touch "$OUT_LOG" "$ERR_LOG"
  tail -f "$OUT_LOG" "$ERR_LOG"
}

case "$COMMAND" in
  start)
    start_daemon
    ;;
  stop)
    stop_daemon
    ;;
  restart)
    stop_daemon
    start_daemon
    ;;
  status)
    status_daemon
    ;;
  logs)
    tail_logs
    ;;
  *)
    printf 'Usage: %s [start|stop|restart|status|logs]\n' "$0" >&2
    exit 2
    ;;
esac
