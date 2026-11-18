#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
uv sync --locked
npm ci
npm run build
exec .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port "${FACTORY_PORT:-8096}"
