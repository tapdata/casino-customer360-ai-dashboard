#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env.external}"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.demo.yml"
OVERLAY_FILE="${ROOT_DIR}/docker-compose.external.yml"

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'External environment file not found: %s\n' "${ENV_FILE}" >&2
  printf 'Copy .env.external.example to .env.external and fill private values.\n' >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" -f "${OVERLAY_FILE}" "$@"
}

env_value() {
  local key="$1"
  local value
  value="$(grep -E "^[[:space:]]*${key}=" "${ENV_FILE}" | tail -n 1 | sed -E 's/^[^=]+=//' || true)"
  value="${value%$'\r'}"
  if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "${value}"
}

require_value() {
  local key="$1"
  if [[ -z "$(env_value "${key}")" ]]; then
    printf 'Missing %s in %s\n' "${key}" "${ENV_FILE}" >&2
    exit 1
  fi
}

require_value TAPDATA_IMPORT_API_BASE_URL
require_value TAPDATA_API_BASE_URL
if [[ -z "$(env_value TAPDATA_IMPORT_TOKEN)" && -z "$(env_value TAPDATA_IMPORT_AUTHORIZATION)" ]]; then
  printf 'Missing TAPDATA_IMPORT_TOKEN or TAPDATA_IMPORT_AUTHORIZATION in %s\n' "${ENV_FILE}" >&2
  exit 1
fi
require_value TAPDATA_IMPORT_SOURCE_MONGODB_URI
require_value TAPDATA_IMPORT_TARGET_MONGODB_URI

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" -f "${OVERLAY_FILE}" config --quiet
node "${ROOT_DIR}/scripts/verify-source-backup.mjs" "${ROOT_DIR}/secrets/mongo-source" >/dev/null

if [[ "$(env_value TAPDATA_IMPORT_RESTORE_SOURCE)" == "true" ]]; then
  source_uri="$(env_value TAPDATA_IMPORT_SOURCE_MONGODB_URI)"
  docker run --rm \
    -e "SOURCE_RESTORE_URI=${source_uri}" \
    -e SOURCE_RESTORE_ALLOW_REMOTE=true \
    -v "${ROOT_DIR}/secrets/mongo-source:/backup:ro" \
    -v "${ROOT_DIR}/scripts/mongo-source-restore.cjs:/restore.cjs:ro" \
    mongo:7 mongosh --nodb --quiet /restore.cjs
fi

compose --profile import run --rm --build --no-deps tapdata-importer node /importer/tapdata-import.mjs api
compose up -d --build mongo bootstrap ai-panel

for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${AI_PANEL_PORT:-3000}/" >/dev/null; then
    printf 'AI panel is ready on port %s\n' "${AI_PANEL_PORT:-3000}"
    exit 0
  fi
  sleep 2
done

printf 'AI panel did not become ready; inspect: docker compose --env-file %s -f %s -f %s logs ai-panel\n' "${ENV_FILE}" "${COMPOSE_FILE}" "${OVERLAY_FILE}" >&2
exit 1
