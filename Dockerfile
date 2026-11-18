# syntax=docker/dockerfile:1.7
FROM node:22-slim AS frontend
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
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=backend /app/.venv /app/.venv
COPY app ./app
COPY --from=frontend /frontend/dist /app/dist
COPY ops/render/start.py ops/render/build_seed.py ./ops/render/
RUN python -m compileall -q /app/app /app/ops/render \
    && mkdir -p /app/seed \
    && python /app/ops/render/build_seed.py \
    && chmod 644 /app/seed/factory.sqlite3
USER app
EXPOSE 10000
CMD ["python", "/app/ops/render/start.py"]
