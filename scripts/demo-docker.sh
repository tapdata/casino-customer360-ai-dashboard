#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.demo.yml"
ENV_FILE="${DEMO_ENV_FILE:-${ROOT_DIR}/.env.demo}"
EXAMPLE_FILE="${ROOT_DIR}/.env.demo.example"

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
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

usage() {
  cat <<'EOF'
Usage: ./scripts/demo-docker.sh <command>

Commands:
  up       Build and start MongoDB, TapData and the AI panel
  sources  Start the optional local PostgreSQL source profile as well
  down     Stop containers (keeps named volumes)
  restart  Rebuild and recreate the application services
  status   Show container status
  logs     Follow all service logs (SERVICE=ai-panel narrows it)
  health   Check the AI panel and MongoDB container state
  reset    Delete containers and volumes only with RESET_VOLUMES_CONFIRM=YES
EOF
}

command="${1:-}"
case "${command}" in
  up)
    compose config --quiet
    compose up -d --build
    compose ps
    ;;
  sources)
    compose config --quiet
    compose --profile sources up -d --build
    compose ps
    ;;
  down) compose down ;;
  restart)
    compose config --quiet
    compose up -d --build --force-recreate
    compose ps
    ;;
  status) compose ps ;;
  logs)
    if [[ -n "${SERVICE:-}" ]]; then compose logs -f "${SERVICE}"; else compose logs -f; fi
    ;;
  health)
    compose ps
    if command -v curl >/dev/null 2>&1; then
      curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${AI_PANEL_PORT:-3000}/" >/dev/null
      printf 'AI panel: OK (http://127.0.0.1:%s)\n' "${AI_PANEL_PORT:-3000}"
    else
      printf 'curl is not installed; inspect the status above.\n'
    fi
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
