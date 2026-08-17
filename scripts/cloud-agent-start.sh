#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$root/agi/data/runtime"
log="${AGI_LOG_PATH:-/tmp/agi-control-plane.log}"
url="http://127.0.0.1:${AGI_PORT:-8787}/health"

if curl -sf "$url" >/dev/null; then
  echo "agi-control-plane already healthy"
  exit 0
fi

if [[ ! -d "$root/agi/node_modules" ]]; then
  echo "agi dependencies missing; run install first" >&2
  exit 1
fi

(
  cd "$root/agi"
  export AGI_MODEL_ID="${AGI_MODEL_ID:-claude-fable-5}"
  export AGI_MODEL_PARAMS="${AGI_MODEL_PARAMS:-thinking=true,context=1m,effort=max}"
  export AGI_MAX_BODY_BYTES="${AGI_MAX_BODY_BYTES:-20971520}"
  export AGI_STREAM_IDLE_TIMEOUT_MS="${AGI_STREAM_IDLE_TIMEOUT_MS:-90000}"
  export AGI_STREAM_HEARTBEAT_MS="${AGI_STREAM_HEARTBEAT_MS:-15000}"
  export AGI_LUCY_POOL="${AGI_LUCY_POOL:-auto}"
  if [[ -n "${AGI_CONTROL_TOKEN:-}" ]]; then
    export AGI_BIND="${AGI_BIND:-0.0.0.0}"
  fi
  nohup node --import tsx src/cli.ts serve >>"$log" 2>&1 &
  echo $! >"$root/agi/data/runtime/agi.pid"
)

for _ in $(seq 1 40); do
  if curl -sf "$url" >/dev/null; then
    echo "agi-control-plane ready"
    exit 0
  fi
  sleep 0.25
done

echo "agi-control-plane failed to become healthy" >&2
tail -n 80 "$log" >&2 || true
exit 1
