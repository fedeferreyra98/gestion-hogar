# Comandos de desarrollo local. Ver docs/06-local-dev.md
# Los targets de backend/frontend avisan claramente si aún no fueron creados (BL-002 / BL-005).

SHELL := /bin/bash
-include .env
export

HAS_BACKEND  := $(shell test -f backend/gradlew && echo yes)
HAS_FRONTEND := $(shell test -f frontend/package.json && echo yes)

define require_backend
	@if [ "$(HAS_BACKEND)" != "yes" ]; then echo "⚠ backend no existe todavía (tarea BL-002). Salteando."; exit 0; fi
endef
define require_frontend
	@if [ "$(HAS_FRONTEND)" != "yes" ]; then echo "⚠ frontend no existe todavía (tarea BL-005). Salteando."; exit 0; fi
endef

.PHONY: help setup hooks check-secrets test-hooks issues-preview issues-create issues-ready up down reset-db psql logs dev backend frontend seed \
        test test-fast test-backend test-frontend lint build smoke verify

help: ## Lista los comandos
	@grep -hE '^[a-zA-Z_-]+:.*?## ' Makefile | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

hooks: ## Instala los git hooks (pre-commit y pre-push: detección de secretos)
	@git config core.hooksPath .githooks && chmod +x .githooks/* && echo "✔ git hooks instalados (.githooks)"

check-secrets: ## Escanea todo el repo en busca de secretos/datos sensibles reales
	python3 -I scripts/check_secrets.py --all

test-hooks: ## Tests de los scripts (escáner de secretos y generador de issues)
	python3 -I -m unittest discover -s scripts/tests -p 'test_*.py'

issues-preview: ## DRY-RUN: muestra qué issues de GitHub se crearían desde el backlog
	python3 -I scripts/backlog_issues.py

issues-create: ## Crea labels, milestones e issues en GitHub (idempotente)
	python3 -I scripts/backlog_issues.py --apply

issues-ready: ## Marca `ready` los issues cuyas dependencias ya están cerradas
	python3 -I scripts/backlog_issues.py --refresh-ready --apply

setup: hooks ## Instala hooks, crea .env (si falta) e instala dependencias
	@test -f .env || (cp .env.example .env && echo "✔ .env creado desde .env.example")
	@if [ "$(HAS_FRONTEND)" = "yes" ]; then cd frontend && npm ci; fi
	@if [ "$(HAS_BACKEND)" = "yes" ]; then cd backend && ./gradlew --quiet dependencies > /dev/null; fi

up: ## Levanta Postgres y espera a que esté healthy
	@test -f .env || cp .env.example .env
	docker compose up -d --wait postgres

down: ## Apaga los contenedores (conserva datos)
	docker compose down

reset-db: ## Borra TODOS los datos locales y recrea Postgres limpio
	docker compose down -v
	docker compose up -d --wait postgres

psql: ## Abre psql contra la BD local
	docker compose exec postgres psql -U $${DB_USER:-hogar} -d $${DB_NAME:-hogar}

logs: ## Sigue los logs de Postgres
	docker compose logs -f postgres

backend: up ## Corre el backend con perfil local (hot reload con devtools)
	@if [ "$(HAS_BACKEND)" = "yes" ]; then cd backend && SPRING_PROFILES_ACTIVE=local ./gradlew bootRun; else echo "⚠ backend no existe todavía (tarea BL-002)."; fi

frontend: ## Corre el frontend (Vite, hot reload)
	@if [ "$(HAS_FRONTEND)" = "yes" ]; then cd frontend && npm run dev; else echo "⚠ frontend no existe todavía (tarea BL-005)."; fi

dev: up ## Levanta Postgres + backend + frontend juntos (Ctrl+C para cortar)
	@trap 'kill 0' INT TERM; \
	( $(MAKE) --no-print-directory backend ) & \
	( $(MAKE) --no-print-directory frontend ) & \
	wait

seed: ## Crea owner + datos demo contra el backend corriendo (idempotente)
	./scripts/seed.sh

# ---- Tests: del más rápido al más completo ----
test-fast: ## Nivel 1: unit tests sin Docker (segundos)
	$(call require_backend)
	@if [ "$(HAS_BACKEND)" = "yes" ]; then cd backend && ./gradlew test --tests '*UnitTest' --tests '*.domain.*' ; fi
	$(call require_frontend)
	@if [ "$(HAS_FRONTEND)" = "yes" ]; then cd frontend && npm run test -- --run; fi

test-backend: ## Nivel 2: todos los tests backend (usa Testcontainers → requiere Docker)
	$(call require_backend)
	@if [ "$(HAS_BACKEND)" = "yes" ]; then cd backend && ./gradlew test; fi

test-frontend: ## Tests frontend (Vitest + MSW, sin backend real)
	$(call require_frontend)
	@if [ "$(HAS_FRONTEND)" = "yes" ]; then cd frontend && npm run test -- --run; fi

test: test-backend test-frontend ## Todos los tests

lint: ## ktlint + eslint + typecheck
	@if [ "$(HAS_BACKEND)" = "yes" ]; then cd backend && ./gradlew ktlintCheck; fi
	@if [ "$(HAS_FRONTEND)" = "yes" ]; then cd frontend && npm run lint && npm run typecheck; fi

build: ## Compila backend y frontend
	@if [ "$(HAS_BACKEND)" = "yes" ]; then cd backend && ./gradlew build -x test; fi
	@if [ "$(HAS_FRONTEND)" = "yes" ]; then cd frontend && npm run build; fi

smoke: ## Nivel 3: prueba end-to-end contra el backend ya corriendo
	./scripts/smoke.sh

verify: check-secrets test-hooks lint test build ## Nivel 4: lo que debe pasar antes de abrir un PR
	@echo "✔ verify OK (para validar con el sistema corriendo: make up && make backend & make smoke)"
