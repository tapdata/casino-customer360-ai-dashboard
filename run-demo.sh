#!/usr/bin/env bash
set -euo pipefail

# Customer entry point. It keeps the public flow to one command after clone:
#
#   bash run-demo.sh
#
# The installer handles Node.js, npm dependencies, the configuration wizard,
# source seed validation/restore, TapData import, and the systemd service.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${1:-$ROOT_DIR/.env.external}"

detect_public_host() {
  if [[ -n "${DEMO_PUBLIC_HOST:-}" ]]; then
    printf '%s' "$DEMO_PUBLIC_HOST"
    return
  fi
  local host
  host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${host:-127.0.0.1}"
}

DEMO_TAPDATA_HOST="${DEMO_TAPDATA_HOST:-127.0.0.1}"
DEMO_MONGO_HOST="${DEMO_MONGO_HOST:-127.0.0.1}"
DEMO_PUBLIC_HOST="$(detect_public_host)"

if [[ "$(uname -s)" != Linux ]]; then
  echo '请在目标 Linux 服务器上运行此命令。' >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  export DEMO_TAPDATA_HOST DEMO_MONGO_HOST DEMO_PUBLIC_HOST
  exec bash "$ROOT_DIR/scripts/install-external.sh" "$CONFIG_FILE"
fi

command -v sudo >/dev/null || {
  echo '需要 sudo；或者直接以 root 运行 bash run-demo.sh。' >&2
  exit 1
}

exec sudo env \
  "DEMO_TAPDATA_HOST=$DEMO_TAPDATA_HOST" \
  "DEMO_MONGO_HOST=$DEMO_MONGO_HOST" \
  "DEMO_PUBLIC_HOST=$DEMO_PUBLIC_HOST" \
  bash "$ROOT_DIR/scripts/install-external.sh" "$CONFIG_FILE"
