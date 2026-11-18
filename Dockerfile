# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY vite.config.js ./
COPY web ./web
RUN npm run build

FROM python:3.12-slim AS backend
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /uvx /bin/
ENV UV_PYTHON_DOWNLOADS=0 UV_LINK_MODE=copy
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project --compile-bytecode

FROM python:3.12-slim AS runtime
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=backend /app/.venv /app/.venv
COPY app ./app
COPY --from=frontend /frontend/dist /app/dist
COPY ops/render/start.py ./ops/render/start.py
RUN python -m compileall -q /app/app /app/ops/render \
    && mkdir -p /app/seed \
    && python - <<'PY'
from contextlib import closing
from app.db import SCHEMA, connect, transaction
from app.seed import seed

with closing(connect("/app/seed/factory.sqlite3")) as db:
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    with transaction(db):
        seed(db)
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.execute("VACUUM")
PY
USER app
EXPOSE 10000
CMD ["python", "/app/ops/render/start.py"]
