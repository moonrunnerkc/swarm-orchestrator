# ── Stage 1: Install dependencies ──
FROM node:20-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: Runtime ──
FROM node:20-slim

LABEL org.opencontainers.image.title="notes-api" \
      org.opencontainers.image.description="Express API with CRUD operations for notes, backed by JSON file storage." \
      org.opencontainers.image.licenses="ISC"

RUN groupadd --system notes && useradd --system --gid notes --home /app notes

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

RUN mkdir -p data && chown notes:notes data

ENV NODE_ENV=production \
    PORT=3002 \
    HOST=0.0.0.0 \
    DATA_FILE=./data/notes.json

USER notes

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http=require('http');const r=http.get('http://127.0.0.1:'+process.env.PORT+'/health',s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
