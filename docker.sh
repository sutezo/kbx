#!/usr/bin/env bash
# Entry point for the kbx development environment on macOS + Docker.
# Usage: ./docker.sh {build|shell|rebuild|clean}
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "Usage: ./docker.sh {build|shell|dev|exec <command...>|rebuild|clean}" >&2
  echo "  build    Build the dev image" >&2
  echo "  shell    Open a shell in the dev container (ports 6606/6506 published)" >&2
  echo "  dev      Run the Vite dev server directly (http://localhost:6606)" >&2
  echo "  exec     Run one command in the dev container, e.g. ./docker.sh exec npm test" >&2
  echo "  rebuild  Rebuild the dev image from scratch (--no-cache)" >&2
  echo "  clean    Remove containers, image, and the node_modules volume" >&2
  exit 1
}

case "${1:-}" in
  build)
    docker compose build
    ;;
  shell)
    docker compose run --rm --service-ports dev bash
    ;;
  dev)
    docker compose run --rm --service-ports dev npm run dev
    ;;
  exec)
    shift
    [ "$#" -gt 0 ] || usage
    docker compose run --rm --service-ports dev "$@"
    ;;
  rebuild)
    docker compose build --no-cache
    ;;
  clean)
    docker compose down --rmi local --volumes --remove-orphans
    ;;
  *)
    usage
    ;;
esac
