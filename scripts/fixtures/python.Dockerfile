FROM node:24-bookworm@sha256:be23f54a88d34e8824c741b19b91064094f92c1c97b194144bfc8b50d67258e2
COPY --from=ghcr.io/astral-sh/uv:0.11.13 /uv /usr/local/libexec/uv
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN mkdir /opt/seed && printf '[project]\nname="python-container-fixture"\nversion="0.1.0"\nrequires-python=">=3.11"\ndependencies=["pytest==9.0.2"]\n' > /opt/seed/pyproject.toml && cd /opt/seed && /usr/local/libexec/uv --cache-dir /opt/uv-cache sync --no-install-project --python /usr/bin/python3 && chmod -R a+rX /opt/uv-cache
RUN printf '#!/bin/sh\ncp -R /opt/uv-cache /tmp/swarm-uv-cache\nexec /usr/local/libexec/uv --cache-dir /tmp/swarm-uv-cache "$@"\n' > /usr/local/bin/uv && chmod 755 /usr/local/bin/uv
