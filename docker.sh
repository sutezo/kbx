#!/usr/bin/env bash
# Entry point for the kbx development environment on macOS + Docker.
# Usage: ./docker.sh {build|shell|rebuild|clean}
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "Usage: ./docker.sh {build|shell|rebuild|clean}" >&2
  echo "  build    Build the dev image" >&2
  echo "  shell    Open a shell in the dev container (ports 5173/4173 published)" >&2
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
