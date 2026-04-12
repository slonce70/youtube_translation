.PHONY: help install install-backend install-frontend backend-venv dev dev-bootstrap dev-bootstrap-v2 dev-bootstrap-down dev-bootstrap-logs dev-bootstrap-v2-logs test test-backend-preflight lint lint-backend lint-frontend i18n-check clean build docker-up docker-down migrate verify-v0

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
NC := \033[0m # No Color

ROOT_DIR := $(CURDIR)
BACKEND_DIR_REL := backend
BACKEND_DIR := $(ROOT_DIR)/backend
BACKEND_VENV := $(BACKEND_DIR)/.venv
PY311 := $(shell command -v python3.11 || command -v python3)
BACKEND_PY := $(BACKEND_VENV)/bin/python
BACKEND_PIP := $(BACKEND_VENV)/bin/pip
DOCKER_COMPOSE := docker compose -f docker/docker-compose.yml
LOAD_BACKEND_ENV := set -a; [ -f "$(BACKEND_DIR)/.env" ] && . "$(BACKEND_DIR)/.env"; set +a
POSTGRES_CONTAINER := youtube-streaming-postgres
REDIS_CONTAINER := youtube-streaming-redis

define ASSERT_COMPOSE_PORT_OWNERSHIP
if nc -z 127.0.0.1 $(1) >/dev/null 2>&1; then \
	running=$$(docker inspect -f '{{.State.Running}}' "$(2)" 2>/dev/null || echo false); \
	if [ "$$running" != "true" ]; then \
		echo "$(3) port 127.0.0.1:$(1) is occupied by a non-Compose service." >&2; \
		echo "$(4)" >&2; \
		exit 1; \
	fi; \
fi
endef

define WAIT_FOR_DOCKER_SERVICE
status="starting"; \
for _ in $$(seq 1 30); do \
	status=$$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(1)" 2>/dev/null || echo missing); \
	if [ "$$status" = "healthy" ] || [ "$$status" = "running" ]; then \
		break; \
	fi; \
	sleep 2; \
done; \
if [ "$$status" != "healthy" ] && [ "$$status" != "running" ]; then \
	echo "Service $(1) is not ready (status=$$status)" >&2; \
	exit 1; \
fi
endef

backend-venv: ## Ensure backend virtualenv exists
	@if [ ! -x "$(BACKEND_PY)" ]; then \
		echo "$(BLUE)Creating backend virtualenv with $(PY311)...$(NC)"; \
		rm -rf "$(BACKEND_VENV)"; \
		cd "$(BACKEND_DIR)" && "$(PY311)" -m venv .venv; \
	fi
	@if [ ! -x "$(BACKEND_PY)" ]; then \
		echo "Failed to bootstrap backend virtualenv at $(BACKEND_VENV)" >&2; \
		exit 1; \
	fi

help: ## Show this help message
	@echo "$(BLUE)YouTube Multi-Channel Streaming Platform - Make Commands$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

# ==========================================
# Installation
# ==========================================

install: backend-venv ## Install all dependencies (backend + frontend)
	@echo "$(BLUE)Installing backend dependencies...$(NC)"
	cd backend && $(BACKEND_PIP) install --upgrade pip && $(BACKEND_PIP) install -r requirements.txt
	@echo "$(BLUE)Installing frontend dependencies...$(NC)"
	cd frontend && npm ci
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

install-backend: backend-venv ## Install backend dependencies only
	@echo "$(BLUE)Installing backend dependencies...$(NC)"
	cd backend && $(BACKEND_PIP) install --upgrade pip && $(BACKEND_PIP) install -r requirements.txt
	@echo "$(GREEN)✓ Backend dependencies installed$(NC)"

install-frontend: ## Install frontend dependencies only
	@echo "$(BLUE)Installing frontend dependencies...$(NC)"
	cd frontend && npm ci
	@echo "$(GREEN)✓ Frontend dependencies installed$(NC)"

# ==========================================
# Development
# ==========================================

dev: ## Start all services (local only)
	@echo "$(BLUE)Starting services (local only)...$(NC)"
	./start-local-dev.sh

dev-local: dev ## Start all services (local only)

dev-bootstrap: ## Start base services for hybrid local dev (postgres, redis, tusd, runner)
	@echo "$(BLUE)Starting hybrid dev base services via Docker Compose...$(NC)"
	@set -eu; \
	$(call ASSERT_COMPOSE_PORT_OWNERSHIP,5432,$(POSTGRES_CONTAINER),postgres,Stop the conflicting local service or free the port before running make dev-bootstrap.); \
	$(call ASSERT_COMPOSE_PORT_OWNERSHIP,6379,$(REDIS_CONTAINER),redis,Stop the conflicting local service or free the port before running make dev-bootstrap.); \
	$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) up -d postgres redis tusd runner
	@echo "$(GREEN)✓ Base services ready$(NC)"

dev-bootstrap-v2: ## Start base services plus optional MediaMTX relay/metrics layer
	@echo "$(BLUE)Starting hybrid dev v2 base services via Docker Compose...$(NC)"
	@set -eu; \
	$(call ASSERT_COMPOSE_PORT_OWNERSHIP,5432,$(POSTGRES_CONTAINER),postgres,Stop the conflicting local service or free the port before running make dev-bootstrap-v2.); \
	$(call ASSERT_COMPOSE_PORT_OWNERSHIP,6379,$(REDIS_CONTAINER),redis,Stop the conflicting local service or free the port before running make dev-bootstrap-v2.); \
	$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) up -d postgres redis tusd runner mediamtx
	@echo "$(GREEN)✓ V2 base services ready$(NC)"

dev-bootstrap-down: ## Stop hybrid local dev base services
	@echo "$(BLUE)Stopping hybrid dev base services...$(NC)"
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) stop mediamtx runner tusd redis postgres
	@echo "$(GREEN)✓ Base services stopped$(NC)"

dev-bootstrap-logs: ## Tail logs for hybrid local dev base services
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) logs -f postgres redis tusd runner

dev-bootstrap-v2-logs: ## Tail logs for hybrid local dev v2 services
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) logs -f postgres redis tusd runner mediamtx

dev-backend: ## Start backend only
	@echo "$(BLUE)Starting backend at http://localhost:8000...$(NC)"
	./start-backend.sh

dev-frontend: ## Start frontend only
	@echo "$(BLUE)Starting frontend at http://localhost:3000...$(NC)"
	./start-frontend.sh

dev-tusd: ## Start tusd only
	@echo "$(BLUE)Starting tusd at http://localhost:1080...$(NC)"
	./start-tusd.sh

# ==========================================
# Testing
# ==========================================

test: test-backend ## Run all tests
	@echo "$(BLUE)Running frontend tests...$(NC)"
	cd frontend && CI=1 npm test
	@echo "$(GREEN)✓ All tests passed$(NC)"

test-backend-preflight: backend-venv ## Ensure local services needed by backend tests are available
	@echo "$(BLUE)Ensuring postgres and redis are running for backend tests...$(NC)"
	@if ! command -v docker >/dev/null 2>&1; then \
		echo "Docker is required for the canonical backend test path." >&2; \
		exit 1; \
	fi
	@set -eu; \
	$(call ASSERT_COMPOSE_PORT_OWNERSHIP,5432,$(POSTGRES_CONTAINER),postgres,Refusing to run backend tests against an arbitrary local dependency. Stop the conflicting service or free the port before rerunning make test.); \
	$(call ASSERT_COMPOSE_PORT_OWNERSHIP,6379,$(REDIS_CONTAINER),redis,Refusing to run backend tests against an arbitrary local dependency. Stop the conflicting service or free the port before rerunning make test.); \
	$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) up -d postgres redis >/dev/null; \
	$(call WAIT_FOR_DOCKER_SERVICE,$(POSTGRES_CONTAINER)); \
	$(call WAIT_FOR_DOCKER_SERVICE,$(REDIS_CONTAINER))

test-backend: test-backend-preflight ## Run backend tests
	@echo "$(BLUE)Running backend tests...$(NC)"
	cd backend && PYTHONDONTWRITEBYTECODE=1 FFMPEG_BIN=tests/bin/ffmpeg $(BACKEND_PY) -m pytest --import-mode=importlib -v

test-backend-coverage: test-backend-preflight ## Run backend tests with coverage
	@echo "$(BLUE)Running backend tests with coverage...$(NC)"
	cd backend && PYTHONDONTWRITEBYTECODE=1 FFMPEG_BIN=tests/bin/ffmpeg $(BACKEND_PY) -m pytest --import-mode=importlib --cov=app --cov-report=html --cov-report=term

test-frontend: ## Run frontend tests
	@echo "$(BLUE)Running frontend tests...$(NC)"
	cd frontend && CI=1 npm test

test-admin: ## Run admin tests (requires RUN_ADMIN_TESTS=1)
	@echo "$(BLUE)Running admin tests...$(NC)"
	cd backend && RUN_ADMIN_TESTS=1 pytest tests/test_admin_api.py -v

# ==========================================
# Code Quality
# ==========================================

lint: ## Run default linters for backend and frontend (Black opt-in via RUN_BLACK=1)
	$(MAKE) lint-backend
	$(MAKE) lint-frontend
	@echo "$(GREEN)✓ All linting passed$(NC)"

lint-backend: backend-venv ## Run backend linters only
	@echo "$(BLUE)Linting backend...$(NC)"
	cd backend && $(BACKEND_PY) -m ruff check app/
	@if [ "$${RUN_BLACK:-0}" = "1" ]; then \
		cd backend && $(BACKEND_PY) -m black --check app/; \
	else \
		echo "$(BLUE)Skipping Black check (set RUN_BLACK=1 to enable)$(NC)"; \
	fi

lint-frontend: ## Run frontend linter only
	@echo "$(BLUE)Linting frontend...$(NC)"
	cd frontend && npm run lint

i18n-check: ## Verify localization files are in sync
	@echo "$(BLUE)Checking i18n consistency...$(NC)"
	cd frontend && npm run i18n:check

lint-fix: backend-venv ## Fix linting issues automatically
	@echo "$(BLUE)Fixing backend code...$(NC)"
	cd backend && $(BACKEND_PY) -m ruff check --fix app/
	cd backend && $(BACKEND_PY) -m black app/
	@echo "$(BLUE)Fixing frontend code...$(NC)"
	cd frontend && npm run lint:fix
	@echo "$(GREEN)✓ Code formatting completed$(NC)"

type-check: backend-venv ## Run default type checking (backend mypy opt-in via RUN_MYPY=1)
	@echo "$(BLUE)Type checking backend...$(NC)"
	@if [ "$${RUN_MYPY:-0}" = "1" ]; then \
		cd backend && $(BACKEND_PY) -m mypy --config-file mypy.ini; \
	else \
		echo "$(BLUE)Skipping mypy (set RUN_MYPY=1 to enable)$(NC)"; \
	fi
	@echo "$(BLUE)Type checking frontend...$(NC)"
	cd frontend && npm run type-check
	@echo "$(GREEN)✓ Type checking passed$(NC)"

verify-v0: backend-venv ## Run the strict V0 stabilization gate
	@echo "$(BLUE)Running strict V0 verification gate...$(NC)"
	$(MAKE) lint RUN_BLACK=1
	$(MAKE) type-check RUN_MYPY=1
	$(MAKE) i18n-check
	$(MAKE) test
	@echo "$(BLUE)Building frontend production bundle...$(NC)"
	cd frontend && npm run build
	@echo "$(BLUE)Running frontend Playwright smoke/e2e...$(NC)"
	cd frontend && npm run test:e2e
	@echo "$(GREEN)✓ V0 verification gate passed$(NC)"

# ==========================================
# Database
# ==========================================

migrate: backend-venv ## Apply database migrations
	@echo "$(BLUE)Applying database migrations...$(NC)"
	cd backend && $(BACKEND_PY) apply_migrations.py
	@echo "$(GREEN)✓ Migrations applied$(NC)"

create-admin: backend-venv ## Create an admin user
	@echo "$(BLUE)Creating admin user...$(NC)"
	cd backend && $(BACKEND_PY) create_admin.py
	@echo "$(GREEN)✓ Admin user created$(NC)"

# ==========================================
# Build
# ==========================================

build: backend-venv ## Build production artifacts
	@echo "$(BLUE)Building backend...$(NC)"
	cd backend && $(BACKEND_PIP) install --upgrade pip
	cd backend && $(BACKEND_PIP) install -r requirements.txt
	@echo "$(BLUE)Building frontend...$(NC)"
	cd frontend && npm run build
	@echo "$(GREEN)✓ Build completed$(NC)"

build-frontend: ## Build frontend only
	@echo "$(BLUE)Building frontend...$(NC)"
	cd frontend && npm run build
	@echo "$(GREEN)✓ Frontend build completed$(NC)"

# ==========================================
# Docker
# ==========================================

docker-up: ## Start all services with Docker Compose
	@echo "$(BLUE)Starting Docker containers...$(NC)"
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) up -d
	@echo "$(GREEN)✓ All containers started$(NC)"

docker-down: ## Stop all Docker containers
	@echo "$(BLUE)Stopping Docker containers...$(NC)"
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) down
	@echo "$(GREEN)✓ All containers stopped$(NC)"

docker-logs: ## View Docker logs
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) logs -f

docker-build: ## Build Docker images
	@echo "$(BLUE)Building Docker images...$(NC)"
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) build
	@echo "$(GREEN)✓ Images built$(NC)"

docker-restart: ## Restart Docker containers
	@echo "$(BLUE)Restarting Docker containers...$(NC)"
	@$(LOAD_BACKEND_ENV); $(DOCKER_COMPOSE) restart
	@echo "$(GREEN)✓ Containers restarted$(NC)"

# ==========================================
# Cleanup
# ==========================================

clean: ## Clean temporary files and caches
	@echo "$(BLUE)Cleaning temporary files...$(NC)"
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	cd frontend && rm -rf .next 2>/dev/null || true
	cd frontend && rm -rf node_modules/.cache 2>/dev/null || true
	@echo "$(GREEN)✓ Cleanup completed$(NC)"

clean-all: clean ## Clean everything including dependencies
	@echo "$(BLUE)Removing all dependencies...$(NC)"
	cd backend && rm -rf .venv 2>/dev/null || true
	cd frontend && rm -rf node_modules 2>/dev/null || true
	@echo "$(GREEN)✓ Full cleanup completed$(NC)"

# ==========================================
# Utilities
# ==========================================

logs-backend: ## View backend logs
	tail -f backend/logs/*.log 2>/dev/null || echo "No logs found"

logs-streams: ## View stream logs
	tail -f streams/*.log 2>/dev/null || echo "No stream logs found"

ps: ## Show running processes
	@echo "$(BLUE)Backend:$(NC)"
	@pgrep -f "uvicorn" | xargs ps -p 2>/dev/null || echo "  Not running"
	@echo "$(BLUE)Frontend:$(NC)"
	@pgrep -f "next dev" | xargs ps -p 2>/dev/null || echo "  Not running"
	@echo "$(BLUE)tusd:$(NC)"
	@pgrep -f "tusd" | xargs ps -p 2>/dev/null || echo "  Not running"

security-audit: backend-venv ## Run security audit
	@echo "$(BLUE)Auditing backend dependencies...$(NC)"
	cd backend && $(BACKEND_PIP) install pip-audit
	cd backend && $(BACKEND_VENV)/bin/pip-audit
	@echo "$(BLUE)Auditing frontend dependencies...$(NC)"
	cd frontend && npm audit --production
	@echo "$(GREEN)✓ Security audit completed$(NC)"
