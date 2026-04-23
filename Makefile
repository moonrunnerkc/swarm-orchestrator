.PHONY: help init install build test clean \
       test-all test-python test-subprojects \
       lint audit

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ── Development ──

init: ## Create .env from .env.example if it doesn't exist
	@test -f .env || (cp .env.example .env && echo "Created .env from .env.example — edit it to add your API keys")
	@test -f .env && echo ".env already exists" || true

install: init ## Install all dependencies
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

audit: ## Run security audit on all dependencies
	npm audit --audit-level=high || true
	cd calculations-api && npm audit --audit-level=high || true
	cd notes-api && npm audit --audit-level=high || true
	pip audit 2>/dev/null || echo "pip-audit not installed, skipping Python audit"
