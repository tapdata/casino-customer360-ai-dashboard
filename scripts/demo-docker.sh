#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.demo.yml"
ENV_FILE="${DEMO_ENV_FILE:-${ROOT_DIR}/.env.demo}"
EXAMPLE_FILE="${ROOT_DIR}/.env.demo.example"

# Preparation is entirely offline: no Docker startup or database writes.
if [[ "${1:-}" == "prepare" ]]; then
  node "${ROOT_DIR}/scripts/verify-source-backup.mjs" "${ROOT_DIR}/secrets/mongo-source"
  node "${ROOT_DIR}/scripts/mongo-source-feeder.mjs" --dry-run
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required. Install Docker Desktop/Engine with Compose v2 first.\n' >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${EXAMPLE_FILE}" "${ENV_FILE}"
  printf 'Created %s from the example. Fill in TapData/API credentials, then run this command again.\n' "${ENV_FILE}" >&2
  exit 1
fi

compose() {
  local files=(-f "${COMPOSE_FILE}")
  if [[ -n "${DEMO_COMPOSE_OVERRIDE:-}" ]]; then files+=(-f "${DEMO_COMPOSE_OVERRIDE}"); fi
  docker compose --env-file "${ENV_FILE}" "${files[@]}" "$@"
}

env_file_value() {
  local key="$1"
  local line=""
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  [[ -f "${ENV_FILE}" ]] || return 0
  line="$(grep -E "^[[:space:]]*${key}=" "${ENV_FILE}" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "${line:0:1}" == '"' && "${line: -1}" == '"' ]]; then line="${line:1:${#line}-2}"; fi
  if [[ "${line:0:1}" == "'" && "${line: -1}" == "'" ]]; then line="${line:1:${#line}-2}"; fi
  printf '%s' "${line}"
}

require_api_server_artifact() {
  local profiles="$(env_file_value COMPOSE_PROFILES)"
  [[ " ${profiles//,/ } " == *" bundled-tapdata "* ]] || return 0

  local jar="$(env_file_value TAPDATA_API_SERVER_JAR)"
  jar="${jar:-./secrets/tapdata-api/apiserver.jar}"
  if [[ "${jar}" != /* ]]; then jar="${ROOT_DIR}/${jar#./}"; fi
  if [[ ! -s "${jar}" ]]; then
    printf 'TapData API Server artifact is required for the bundled stack.\n' >&2
    printf 'Place the authorized Enterprise apiserver JAR at %s or set TAPDATA_API_SERVER_JAR.\n' "${jar}" >&2
    printf 'The public community image does not contain the 3080 API Server.\n' >&2
    exit 1
  fi
}

usage() {
  cat <<'EOF'
Usage: ./scripts/demo-docker.sh <command>

Commands:
  prepare  Verify private source backup and print an offline feeder plan
  up       Restore source backup into empty bundled MongoDB and start services
  feeder   Start the optional Mongo-only source feeder
  all      Start the core stack and the Mongo-only source feeder
  once     Run one feeder tick and exit (does not keep a feeder running)
  down     Stop containers (keeps named volumes)
  restart  Rebuild and recreate the core application services
  prepare-import  Validate export files and write a redacted import manifest
  import   Automatically upload the task and API packages through TapData
  task-start  Optionally call the exact TapData task-start endpoint you configured
  status   Show container status
  logs     Follow logs (SERVICE=ai-panel or source-feeder narrows it)
  health   Check the AI panel and MongoDB container state
  reset    Delete containers and volumes only with RESET_VOLUMES_CONFIRM=YES
EOF
}

command="${1:-}"
case "${command}" in
  up|restart)
    node "${ROOT_DIR}/scripts/verify-source-backup.mjs" "${ROOT_DIR}/secrets/mongo-source" >/dev/null
    ;;
  feeder|sources|all|once)
    compose --profile feeder config --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{if(String(JSON.parse(s).services["source-feeder"]?.environment?.FEEDER_WRITE_ENABLED)!=="true"){console.error("Data writes are disabled. Obtain approval before setting FEEDER_WRITE_ENABLED=true.");process.exit(1)}})'
    node "${ROOT_DIR}/scripts/verify-source-backup.mjs" "${ROOT_DIR}/secrets/mongo-source" >/dev/null
    ;;
esac
case "${command}" in
  up|restart|all)
    require_api_server_artifact
    ;;
esac
case "${command}" in
  up)
    compose config --quiet
    compose up -d --build
    compose ps
    ;;
  feeder|sources)
    compose config --quiet
    compose --profile feeder up -d --build source-feeder
    compose ps
    ;;
  all)
    compose config --quiet
    compose up -d --build
    compose --profile feeder up -d --build source-feeder
    compose ps
    ;;
  once)
    compose config --quiet
    compose --profile feeder run --rm --build source-feeder node /feeder/mongo-source-feeder.mjs --once
    ;;
  down) compose down ;;
  restart)
    compose config --quiet
    compose up -d --build --force-recreate
    compose ps
    ;;
  prepare-import)
    compose config --quiet
    compose --profile import run --rm --build --no-deps tapdata-importer node /importer/tapdata-import.mjs prepare
    ;;
  import)
    compose config --quiet
    compose --profile import run --rm --build --no-deps tapdata-importer node /importer/tapdata-import.mjs api
    ;;
  task-start)
    compose config --quiet
    compose --profile import run --rm --build --no-deps tapdata-importer node /importer/tapdata-import.mjs start
    ;;
  status) compose ps ;;
  logs)
    if [[ -n "${SERVICE:-}" ]]; then compose logs -f "${SERVICE}"; else compose logs -f; fi
    ;;
  health)
    compose ps
    compose exec -T mongo mongosh --quiet --host 127.0.0.1 /opt/demo/replica-health.js
    compose exec -T ai-panel node -e 'fetch("http://127.0.0.1:3000/", {signal: AbortSignal.timeout(5000)}).then(r => { if (!r.ok) process.exit(1); console.log("AI panel: OK"); }).catch(() => process.exit(1))'
    ;;
  reset)
    if [[ "${RESET_VOLUMES_CONFIRM:-}" != "YES" ]]; then
      printf 'Refusing to delete demo volumes. Re-run with RESET_VOLUMES_CONFIRM=YES.\n' >&2
      exit 2
    fi
    compose down -v
    ;;
  *) usage; exit 2 ;;
esac
