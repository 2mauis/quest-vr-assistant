#!/bin/sh
# Local relay + named Tunnel. Credentials remain in private files outside Git.
set -eu
CFG="${QVR_CONFIG_DIR:-$HOME/.config/quest-vr-assistant}"
REPO="${QVR_REPO:-$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)}"
LOG="$CFG/logs"
mkdir -p "$LOG"

alive() {
  python3 - "$1" "$2" <<'PY'
from pathlib import Path
import os, subprocess, sys
try:
    pid = int(Path(sys.argv[1]).read_text().strip())
    if pid <= 1: raise ValueError()
    os.kill(pid, 0)
    command = subprocess.check_output(['ps', '-p', str(pid), '-o', 'command='], text=True).strip()
    marker = 'scripts/start-named-tunnel.mjs' if sys.argv[2] == 'tunnel' else 'services/relay/src/index.js'
    assert 'node' in command and marker in command
except (OSError, ValueError, AssertionError, subprocess.SubprocessError):
    sys.exit(1)
PY
}

launch() {
  python3 - "$@" <<'PY'
import os, subprocess, sys
pid_file, log_file, *command = sys.argv[1:]
with open(log_file, 'ab', buffering=0) as log:
    os.chmod(log_file, 0o600)
    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
fd = os.open(pid_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as output: output.write(str(child.pid) + '\n')
PY
}

load_tunnel() {
  [ -f "$CFG/named-tunnel.env" ] || { echo "缺少私有 named-tunnel.env；参见 config/cloudflared/README.md" >&2; exit 1; }
  set -a
  . "$CFG/named-tunnel.env"
  set +a
  node "$REPO/scripts/start-named-tunnel.mjs" --check
}

start_relay() {
  if alive "$CFG/relay.pid" relay; then echo "中继已在运行"; return; fi
  [ -f "$CFG/local.env" ] || { echo "缺少中继 local.env" >&2; exit 1; }
  [ -d "$REPO/node_modules" ] || (cd "$REPO" && npm ci --silent)
  (
    set -a
    . "$CFG/local.env"
    set +a
    cd "$REPO"
    launch "$CFG/relay.pid" "$LOG/relay.log" node services/relay/src/index.js
  )
  for i in $(seq 1 20); do
    if alive "$CFG/relay.pid" relay && curl --max-time 2 -fsS -o /dev/null http://localhost:8787/; then echo "中继已启动"; return; fi
    sleep 0.5
  done
  echo "中继启动未确认；检查本地 relay.log" >&2
  return 1
}

start_tunnel() {
  load_tunnel
  if ! alive "$CFG/cloudflared.pid" tunnel; then
    # Never replace an unrecognized live PID (for example the old Quick Tunnel).
    if [ -s "$CFG/cloudflared.pid" ] && kill -0 "$(cat "$CFG/cloudflared.pid")" 2>/dev/null; then
      echo "记录中仍有其他隧道进程；先完成切换交接，不自动停止它。" >&2
      return 1
    fi
    launch "$CFG/cloudflared.pid" "$LOG/named-tunnel.log" node "$REPO/scripts/start-named-tunnel.mjs"
  fi
  for i in $(seq 1 30); do
    if alive "$CFG/cloudflared.pid" tunnel; then
      code=$(curl --max-time 4 -s -o /dev/null -w '%{http_code}' "$MCP_PUBLIC_URL" || true)
      if [ "$code" = 401 ]; then
        (umask 077; printf '%s\n' "$MCP_PUBLIC_URL" > "$CFG/current-url.txt")
        chmod 600 "$CFG/current-url.txt"
        echo "具名 Tunnel 入口可达，鉴权启用（401）"
        return
      fi
    else break
    fi
    sleep 1
  done
  echo "具名入口尚未确认可达；检查本地 named-tunnel.log" >&2
  return 1
}

stop_one() {
  if alive "$1" "$2"; then
    kill "$(cat "$1")"
    for i in $(seq 1 20); do
      if ! alive "$1" "$2"; then rm -f "$1"; return; fi
      sleep 0.2
    done
    echo "进程尚未退出，保留 PID 记录" >&2; return 1
  fi
  if [ -s "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; then
    echo "PID 不属于此 helper，未停止" >&2; return 1
  fi
  rm -f "$1"
}

case "${1:-status}" in
  up) load_tunnel; start_relay; start_tunnel ;;
  tunnel) start_tunnel ;;
  down) stop_one "$CFG/cloudflared.pid" tunnel; stop_one "$CFG/relay.pid" relay ;;
  status)
    alive "$CFG/relay.pid" relay && echo "中继进程：运行中" || echo "中继进程：未确认"
    alive "$CFG/cloudflared.pid" tunnel && echo "具名 Tunnel 进程：运行中" || echo "具名 Tunnel 进程：未确认"
    load_tunnel
    location=本机
    for endpoint in http://localhost:8788/mcp "$MCP_PUBLIC_URL"; do
      code=$(curl --max-time 10 -s -o /dev/null -w '%{http_code}' "$endpoint" || true)
      if [ "$code" = 401 ]; then echo "$location MCP 入口：可达，鉴权启用（401）"; else echo "$location MCP 入口：未确认可达（${code:-000}）"; fi
      location=公网
    done ;;
  url) load_tunnel >/dev/null; printf '%s\n' "$MCP_PUBLIC_URL" ;;
  *) echo "用法：qvr up | tunnel | down | status | url" >&2; exit 2 ;;
esac
