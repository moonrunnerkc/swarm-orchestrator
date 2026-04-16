#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-latest}"
REGISTRY="${REGISTRY:-ghcr.io/moonrunnerkc}"

echo "==> Building images (tag: ${TAG})"
docker build -t "${REGISTRY}/swarm-orchestrator:${TAG}" .
docker build -t "${REGISTRY}/health-service:${TAG}" -f app/Dockerfile .
docker build -t "${REGISTRY}/calculations-api:${TAG}" ./calculations-api
docker build -t "${REGISTRY}/notes-api:${TAG}" ./notes-api

echo "==> Pushing images to ${REGISTRY}"
docker push "${REGISTRY}/swarm-orchestrator:${TAG}"
docker push "${REGISTRY}/health-service:${TAG}"
docker push "${REGISTRY}/calculations-api:${TAG}"
docker push "${REGISTRY}/notes-api:${TAG}"

echo "==> Deploy complete"
echo "  swarm-orchestrator: ${REGISTRY}/swarm-orchestrator:${TAG}"
echo "  health-service:     ${REGISTRY}/health-service:${TAG}"
echo "  calculations-api:   ${REGISTRY}/calculations-api:${TAG}"
echo "  notes-api:          ${REGISTRY}/notes-api:${TAG}"
