.PHONY: help install dev test lint clean build docker-up docker-down migrate

# Colors for output
BLUE := \033[0;34m
GREEN := \033[0;32m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)YouTube Multi-Channel Streaming Platform - Make Commands$(NC)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2}'

# ==========================================
# Installation
# ==========================================

install: ## Install all dependencies (backend + frontend)
	@echo "$(BLUE)Installing backend dependencies...$(NC)"
	cd backend && python3 -m pip install -r requirements.txt
	@echo "$(BLUE)Installing frontend dependencies...$(NC)"
	cd frontend && npm install
	@echo "$(GREEN)✓ All dependencies installed$(NC)"

install-backend: ## Install backend dependencies only
	@echo "$(BLUE)Installing backend dependencies...$(NC)"
	cd backend && python3 -m pip install -r requirements.txt
	@echo "$(GREEN)✓ Backend dependencies installed$(NC)"

install-frontend: ## Install frontend dependencies only
	@echo "$(BLUE)Installing frontend dependencies...$(NC)"
	cd frontend && npm install
	@echo "$(GREEN)✓ Frontend dependencies installed$(NC)"

# ==========================================
# Development
# ==========================================

dev: ## Start all services in development mode
	@echo "$(BLUE)Starting services...$(NC)"
	@echo "Backend: http://localhost:8000"
	@echo "Frontend: http://localhost:3000"
	@echo "tusd: http://localhost:1080"
	@trap 'kill 0' INT; \
		./start-backend.sh & \
		./start-frontend.sh & \
		./start-tusd.sh & \
		wait

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

test: ## Run all tests
	@echo "$(BLUE)Running backend tests...$(NC)"
	cd backend && pytest -v
	@echo "$(BLUE)Running frontend tests...$(NC)"
	cd frontend && npm test
	@echo "$(GREEN)✓ All tests passed$(NC)"

test-backend: ## Run backend tests
	@echo "$(BLUE)Running backend tests...$(NC)"
	cd backend && pytest -v

test-backend-coverage: ## Run backend tests with coverage
	@echo "$(BLUE)Running backend tests with coverage...$(NC)"
	cd backend && pytest --cov=app --cov-report=html --cov-report=term

test-frontend: ## Run frontend tests
	@echo "$(BLUE)Running frontend tests...$(NC)"
	cd frontend && npm test

test-admin: ## Run admin tests (requires RUN_ADMIN_TESTS=1)
	@echo "$(BLUE)Running admin tests...$(NC)"
	cd backend && RUN_ADMIN_TESTS=1 pytest tests/test_admin_api.py -v

# ==========================================
# Code Quality
# ==========================================

lint: ## Run linters for backend and frontend
	@echo "$(BLUE)Linting backend...$(NC)"
	cd backend && python3 -m ruff check app/
	cd backend && python3 -m black --check app/
	@echo "$(BLUE)Linting frontend...$(NC)"
	cd frontend && npm run lint
	@echo "$(GREEN)✓ All linting passed$(NC)"

lint-fix: ## Fix linting issues automatically
	@echo "$(BLUE)Fixing backend code...$(NC)"
	cd backend && python3 -m ruff check --fix app/
	cd backend && python3 -m black app/
	@echo "$(BLUE)Fixing frontend code...$(NC)"
	cd frontend && npm run lint -- --fix
	@echo "$(GREEN)✓ Code formatting completed$(NC)"

type-check: ## Run type checking
	@echo "$(BLUE)Type checking backend...$(NC)"
	cd backend && python3 -m mypy app/
	@echo "$(BLUE)Type checking frontend...$(NC)"
	cd frontend && npm run type-check
	@echo "$(GREEN)✓ Type checking passed$(NC)"

# ==========================================
# Database
# ==========================================

migrate: ## Apply database migrations
	@echo "$(BLUE)Applying database migrations...$(NC)"
	cd backend && python3 apply_migrations.py
	@echo "$(GREEN)✓ Migrations applied$(NC)"

create-admin: ## Create an admin user
	@echo "$(BLUE)Creating admin user...$(NC)"
	cd backend && python3 create_admin.py
	@echo "$(GREEN)✓ Admin user created$(NC)"

# ==========================================
# Build
# ==========================================

build: ## Build production artifacts
	@echo "$(BLUE)Building backend...$(NC)"
	cd backend && python3 -m pip install --upgrade pip
	cd backend && python3 -m pip install -r requirements.txt
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
	docker compose -f docker/docker-compose.yml up -d
	@echo "$(GREEN)✓ All containers started$(NC)"

docker-down: ## Stop all Docker containers
	@echo "$(BLUE)Stopping Docker containers...$(NC)"
	docker compose -f docker/docker-compose.yml down
	@echo "$(GREEN)✓ All containers stopped$(NC)"

docker-logs: ## View Docker logs
	docker compose -f docker/docker-compose.yml logs -f

docker-build: ## Build Docker images
	@echo "$(BLUE)Building Docker images...$(NC)"
	docker compose -f docker/docker-compose.yml build
	@echo "$(GREEN)✓ Images built$(NC)"

docker-restart: ## Restart Docker containers
	@echo "$(BLUE)Restarting Docker containers...$(NC)"
	docker compose -f docker/docker-compose.yml restart
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

security-audit: ## Run security audit
	@echo "$(BLUE)Auditing backend dependencies...$(NC)"
	cd backend && python3 -m pip install pip-audit
	cd backend && pip-audit
	@echo "$(BLUE)Auditing frontend dependencies...$(NC)"
	cd frontend && npm audit --production
	@echo "$(GREEN)✓ Security audit completed$(NC)"
