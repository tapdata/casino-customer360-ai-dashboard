#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [[ "$(uname -s)" != Linux || "$(id -u)" != 0 ]]; then
  echo 'Run on the target Linux server: sudo bash scripts/install-external.sh [config-file]' >&2
  exit 1
fi
[[ -d /run/systemd/system ]] || { echo 'A running systemd host is required.' >&2; exit 1; }
# Install only bootstrap utilities, never a MongoDB server or TapData.
if ! command -v curl >/dev/null || ! command -v xz >/dev/null; then
  if command -v apt-get >/dev/null; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl xz-utils
  elif command -v dnf >/dev/null; then
    dnf install -y ca-certificates curl xz
  else
    echo 'Install curl, CA certificates and xz first (automatic install supports apt/dnf).' >&2
    exit 1
  fi
fi
RUNTIME_DIR="$ROOT_DIR/runtime/node"
if [[ -x "$RUNTIME_DIR/bin/node" ]]; then export PATH="$RUNTIME_DIR/bin:$PATH"; fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' >/dev/null 2>&1; then
  case "$(uname -m)" in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) echo 'Supported architectures: x86_64 and arm64' >&2; exit 1;; esac
  NODE_VERSION=v22.23.2
  ARCHIVE="node-${NODE_VERSION}-linux-${ARCH}.tar.xz"
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  BASE_URL="https://nodejs.org/dist/${NODE_VERSION}"
  curl --fail --show-error --silent --location --retry 3 --proto '=https' "$BASE_URL/$ARCHIVE" -o "$TMP_DIR/$ARCHIVE"
  curl --fail --show-error --silent --location --retry 3 --proto '=https' "$BASE_URL/SHASUMS256.txt" -o "$TMP_DIR/SHASUMS256.txt"
  (cd "$TMP_DIR" && awk -v file="$ARCHIVE" '$2 == file { print }' SHASUMS256.txt > selected.sha256 && test -s selected.sha256 && sha256sum -c selected.sha256)
  mkdir -p "$RUNTIME_DIR"
  tar -xJf "$TMP_DIR/$ARCHIVE" --strip-components=1 -C "$RUNTIME_DIR"
  export PATH="$RUNTIME_DIR/bin:$PATH"
  node --version
fi
CONFIG_FILE="${1:-$ROOT_DIR/.env.external}"
node scripts/configure-external.mjs "$CONFIG_FILE"
# The lockfile pins app dependencies. Existing app processes are stopped only by
# the deployment orchestrator after preflight and build have succeeded.
npm ci --include=dev
exec node scripts/external-demo.mjs "$CONFIG_FILE" install
