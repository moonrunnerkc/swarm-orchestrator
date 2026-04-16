# ── Stage 1: Build wheels ──
FROM python:3.12-slim AS build

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

COPY pyproject.toml ./
RUN pip wheel --wheel-dir=/wheels \
      "fastapi>=0.110" \
      "pydantic>=2.0" \
      "sqlalchemy>=1.4" \
      "uvicorn>=0.27"

# ── Stage 2: Runtime ──
FROM python:3.12-slim

LABEL org.opencontainers.image.title="health-service" \
      org.opencontainers.image.description="FastAPI health endpoint reporting uptime, DB connectivity, and UTC timestamp." \
      org.opencontainers.image.licenses="ISC"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HOST=0.0.0.0 \
    PORT=8000

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system health && useradd --system --gid health --home /app health

WORKDIR /app

COPY --from=build /wheels /wheels
RUN pip install --no-index --find-links=/wheels \
      fastapi pydantic sqlalchemy uvicorn \
    && rm -rf /wheels

COPY app/ ./app/

USER health

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl --fail --silent "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host ${HOST} --port ${PORT}"]
