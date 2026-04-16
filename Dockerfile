# ── Stage 1: Build ──
FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src/ src/
RUN npm run build

# ── Stage 2: Production ──
FROM node:20-slim

LABEL org.opencontainers.image.title="swarm-orchestrator" \
      org.opencontainers.image.description="Verification and governance layer for AI coding agents" \
      org.opencontainers.image.source="https://github.com/moonrunnerkc/swarm-orchestrator" \
      org.opencontainers.image.licenses="ISC" \
      org.opencontainers.image.vendor="Bradley R. Kinnard"

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system swarm && useradd --system --gid swarm swarm

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist/ dist/
COPY agents/ agents/
COPY config/ config/
COPY plugin/ plugin/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chmod +x dist/src/cli.js

# Run as non-root
USER swarm

ENTRYPOINT ["/entrypoint.sh"]
