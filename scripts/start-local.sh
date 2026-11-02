#!/bin/sh
# One process serves the display, the relay, and the MCP listener.
set -eu
cd "$(dirname "$0")/.."

required="HOST PORT TUNNEL_HOST TUNNEL_PORT PUBLIC_BASE_URL MCP_BEARER_SECRET DEVICE_PAIRING_TOKEN"
for name in $required; do
  eval "value=\${$name-}"
  if [ -z "$value" ]; then
    echo "缺少环境变量 ${name}。请在当前 shell 中设置它；不要把秘密写入仓库。" >&2
    exit 1
  fi
done

exec node services/relay/src/index.ts
