#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.demo.yml"
ENV_FILE="${ROOT_DIR}/.env.demo"

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Missing %s. Copy .env.demo.example to .env.demo and fill the required values.\n' "${ENV_FILE}" >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

usage() {
  cat <<'EOF'
Usage: ./scripts/demo.sh <command>

Commands:
  up       Build and start MongoDB, TapData and the AI panel
  sources  Start the optional local PostgreSQL source profile as well
  down     Stop containers (keeps named volumes)
  status   Show container status
  logs     Follow all service logs (use SERVICE=ai-panel to narrow it)
  reset    Remove containers and volumes only with RESET_VOLUMES_CONFIRM=YES
EOF
}

command="${1:-}"
case "${command}" in
  up) compose up -d --build ;;
  sources) compose --profile sources up -d --build ;;
  down) compose down ;;
  status) compose ps ;;
  logs)
    if [[ -n "${SERVICE:-}" ]]; then compose logs -f "${SERVICE}"; else compose logs -f; fi
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

