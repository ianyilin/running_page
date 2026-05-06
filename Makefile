.PHONY: help sync dev lint check format build ci

help:
	@echo "Available targets:"
	@echo "  make sync    - Sync Strava runs into local data files"
	@echo "  make dev     - Start local Vite server"
	@echo "  make lint    - Run frontend lint"
	@echo "  make check   - Run frontend format check"
	@echo "  make format  - Format frontend files"
	@echo "  make build   - Build frontend assets"
	@echo "  make ci      - Run lint, check, and build"

sync:
	pnpm data:download:strava

dev:
	pnpm dev

lint:
	pnpm run lint

check:
	pnpm run check

format:
	pnpm run format

build:
	pnpm run build

ci: lint check build
