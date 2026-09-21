#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
command -v node >/dev/null || { echo 'Install Node.js >=22.13 first.' >&2; exit 1; }
exec node scripts/external-demo.mjs "${1:-.env.external}" "${2:-install}"
