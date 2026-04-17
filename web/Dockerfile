FROM node:25-slim

LABEL org.opencontainers.image.title="inkwell" \
      org.opencontainers.image.description="Browser-based markdown editor with live preview and notes API proxy." \
      org.opencontainers.image.licenses="ISC"

RUN groupadd --system inkwell && useradd --system --gid inkwell --home /app inkwell

WORKDIR /app

COPY package.json ./
COPY dev-server.js ./
COPY index.html ./
COPY src/ ./src/

ENV NODE_ENV=production \
    DEV_PORT=5173 \
    API_URL=http://notes-api:3002

USER inkwell

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "const http=require('http');const r=http.get('http://127.0.0.1:'+process.env.DEV_PORT+'/',s=>{process.exit(s.statusCode===200?0:1)});r.on('error',()=>process.exit(1))"

CMD ["node", "dev-server.js"]
