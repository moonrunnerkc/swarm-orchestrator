FROM node:24-bookworm@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /opt/swarm-browser
RUN npm init -y && npm install --ignore-scripts --no-audit --no-fund @playwright/test@1.63.0 && npx playwright install --with-deps chromium
