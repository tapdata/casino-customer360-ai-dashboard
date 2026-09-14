#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible entry point. Keep all Docker lifecycle logic in one
# script so future operators can use either documented command.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "${ROOT_DIR}/scripts/demo-docker.sh" "$@"
