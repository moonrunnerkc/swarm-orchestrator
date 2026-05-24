# ── Stage 1: Build ──
FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json tsconfig.docker.json ./
COPY scripts/copy-non-ts-assets.js scripts/
COPY src/ src/
RUN npm run build:docker

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
COPY config/ config/
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chmod +x dist/src/cli.js

ENV NODE_ENV=production

# Run as non-root
USER swarm

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "try { require('./dist/src/cli.js'); process.exit(0); } catch { process.exit(1); }"

ENTRYPOINT ["/entrypoint.sh"]
