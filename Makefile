.PHONY: help install build test clean \
       docker-build docker-up docker-down docker-logs \
       test-all test-python test-subprojects \
       deploy healthcheck lint audit

REGISTRY ?= ghcr.io/moonrunnerkc
TAG      ?= latest

# ── Service URLs (override via env or make args) ──
HEALTH_SERVICE_HOST ?= $(or $(HOST),localhost)
HEALTH_SERVICE_PORT ?= $(or $(PORT),8000)
CALC_API_PORT       ?= 3001
NOTES_API_PORT      ?= 3002

HEALTH_SERVICE_URL ?= http://$(HEALTH_SERVICE_HOST):$(HEALTH_SERVICE_PORT)/api/health
CALC_API_URL       ?= http://$(HEALTH_SERVICE_HOST):$(CALC_API_PORT)/api/health
NOTES_API_URL      ?= http://$(HEALTH_SERVICE_HOST):$(NOTES_API_PORT)/health

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Development ──

install: ## Install all dependencies
	npm ci
	cd calculations-api && npm ci
	cd notes-api && npm ci
	pip install ".[dev]" 2>/dev/null || true

build: ## Build TypeScript
	npm run build

clean: ## Remove build artifacts
	npm run clean

# ── Testing ──

test: build ## Run main test suite
	npm run test:ci

test-python: ## Run Python (health-service) tests
	pytest app/tests/ -v

test-subprojects: ## Run all subproject test suites
	cd calculations-api && npm test
	cd notes-api && npm test
	cd calculator && npm test
	cd logtail && npm test
	cd tictactoe && npm test
	cd web && npm test

test-all: test test-python test-subprojects ## Run every test suite

# ── Docker ──

docker-build: ## Build all Docker images
	docker build -t $(REGISTRY)/swarm-orchestrator:$(TAG) .
	docker build -t $(REGISTRY)/health-service:$(TAG) -f app/Dockerfile .
	docker build -t $(REGISTRY)/calculations-api:$(TAG) ./calculations-api
	docker build -t $(REGISTRY)/notes-api:$(TAG) ./notes-api

docker-up: ## Start all services via docker compose
	docker compose up --build -d

docker-down: ## Stop all services
	docker compose down

docker-logs: ## Tail logs from all services
	docker compose logs -f

# ── Deployment ──

deploy: ## Build and push images (REGISTRY and TAG configurable)
	bash scripts/deploy.sh "$(TAG)"

deploy-pull: ## Pull pre-built images and deploy (REGISTRY and TAG configurable)
	bash scripts/deploy.sh "$(TAG)" --pull

rollback: ## Roll back to a previous tag (usage: make rollback TAG=current ROLLBACK_TAG=previous)
	bash scripts/deploy.sh "$(TAG)" --rollback "$(ROLLBACK_TAG)"

healthcheck: ## Run health check against local services
	bash scripts/healthcheck.sh $(HEALTH_SERVICE_URL) 5
	bash scripts/healthcheck.sh $(CALC_API_URL) 5
	bash scripts/healthcheck.sh $(NOTES_API_URL) 5

audit: ## Run security audit on all dependencies
	npm audit --audit-level=high || true
	cd calculations-api && npm audit --audit-level=high || true
	cd notes-api && npm audit --audit-level=high || true
	pip audit 2>/dev/null || echo "pip-audit not installed, skipping Python audit"
