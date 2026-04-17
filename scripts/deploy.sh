#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-latest}"
REGISTRY="${REGISTRY:-ghcr.io/moonrunnerkc}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_PROD="${COMPOSE_PROD:-docker-compose.prod.yml}"

IMAGES=(
    swarm-orchestrator
    health-service
    calculations-api
    notes-api
)

usage() {
    echo "Usage: $0 <tag> [--build|--pull|--rollback <previous-tag>]"
    echo ""
    echo "Commands:"
    echo "  $0 <tag>                    Build and push all images with the given tag"
    echo "  $0 <tag> --pull             Pull and deploy pre-built images"
    echo "  $0 <tag> --rollback <prev>  Roll back to a previous tag"
}

build_and_push() {
    echo "==> Building images (tag: ${TAG})"
    docker build -t "${REGISTRY}/swarm-orchestrator:${TAG}" .
    docker build -t "${REGISTRY}/health-service:${TAG}" -f app/Dockerfile .
    docker build -t "${REGISTRY}/calculations-api:${TAG}" ./calculations-api
    docker build -t "${REGISTRY}/notes-api:${TAG}" ./notes-api

    echo "==> Pushing images to ${REGISTRY}"
    for img in "${IMAGES[@]}"; do
        docker push "${REGISTRY}/${img}:${TAG}"
    done

    echo "==> Deploy complete"
    for img in "${IMAGES[@]}"; do
        echo "  ${img}: ${REGISTRY}/${img}:${TAG}"
    done
}

pull_and_deploy() {
    echo "==> Pulling images (tag: ${TAG})"
    for img in "${IMAGES[@]}"; do
        docker pull "${REGISTRY}/${img}:${TAG}"
    done

    echo "==> Deploying with docker compose"
    DEPLOY_TAG="${TAG}" REGISTRY="${REGISTRY}" \
        docker compose -f "${COMPOSE_FILE}" -f "${COMPOSE_PROD}" up -d

    echo "==> Deployment complete (tag: ${TAG})"
}

rollback() {
    local prev_tag="$1"
    echo "==> Rolling back from ${TAG} to ${prev_tag}"
    TAG="${prev_tag}" pull_and_deploy
    echo "==> Rollback complete (now running: ${prev_tag})"
}

# Parse arguments
MODE="build"
ROLLBACK_TAG=""

shift || true
while [ $# -gt 0 ]; do
    case "$1" in
        --build)   MODE="build"; shift ;;
        --pull)    MODE="pull"; shift ;;
        --rollback)
            MODE="rollback"
            ROLLBACK_TAG="${2:-}"
            if [ -z "${ROLLBACK_TAG}" ]; then
                echo "Error: --rollback requires a previous tag argument"
                usage
                exit 1
            fi
            shift 2
            ;;
        --help|-h) usage; exit 0 ;;
        *) echo "Unknown option: $1"; usage; exit 1 ;;
    esac
done

case "${MODE}" in
    build)    build_and_push ;;
    pull)     pull_and_deploy ;;
    rollback) rollback "${ROLLBACK_TAG}" ;;
esac
