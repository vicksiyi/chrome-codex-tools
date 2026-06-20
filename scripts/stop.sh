#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVER_PATH="${ROOT_DIR}/local-codex-bridge/server.ts"
SERVER_REL_PATH="local-codex-bridge/server.ts"

stop_launch_agent() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return
  fi

  if [ -x "${ROOT_DIR}/scripts/autostart.sh" ]; then
    sh "${ROOT_DIR}/scripts/autostart.sh" stop || true
  fi
}

stop_daemon() {
  if [ -x "${ROOT_DIR}/scripts/daemon.sh" ]; then
    sh "${ROOT_DIR}/scripts/daemon.sh" stop || true
  fi
}

find_server_pids() {
  if command -v pgrep >/dev/null 2>&1; then
    {
      pgrep -f "node .*${SERVER_PATH}" 2>/dev/null || true
      pgrep -f "node .*${SERVER_REL_PATH}" 2>/dev/null || true
    } | sort -u
  fi
}

wait_until_stopped() {
  pid="$1"
  attempts=0

  while kill -0 "$pid" >/dev/null 2>&1 && [ "$attempts" -lt 10 ]; do
    attempts=$((attempts + 1))
    sleep 1
  done
}

stop_orphaned_servers() {
  pids="$(find_server_pids)"
  if [ -z "$pids" ]; then
    printf 'No orphaned Codex Web Assistant bridge processes found.\n'
    return
  fi

  for pid in $pids; do
    case "$pid" in
      ''|*[!0-9]*)
        continue
        ;;
    esac

    if [ "$pid" = "$$" ]; then
      continue
    fi

    if ! kill -0 "$pid" >/dev/null 2>&1; then
      continue
    fi

    kill "$pid" >/dev/null 2>&1 || true
    wait_until_stopped "$pid"

    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -KILL "$pid" >/dev/null 2>&1 || true
    fi

    printf 'Stopped orphaned Codex Web Assistant bridge process. PID: %s\n' "$pid"
  done
}

stop_launch_agent
stop_daemon
stop_orphaned_servers
printf 'Codex Web Assistant bridge stop command completed.\n'
