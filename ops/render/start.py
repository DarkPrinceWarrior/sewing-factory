"""Entrypoint for running sewing-factory inside Render Free Docker."""

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_SEED_DB = Path("/app/seed/factory.sqlite3")
DEFAULT_FACTORY_DB = "/tmp/factory/factory.sqlite3"


def main() -> int:
    port_raw = (os.environ.get("PORT") or "10000").strip()
    port = int(port_raw)
    if not 1 <= port <= 65535:
        raise ValueError(f"PORT must be between 1 and 65535, got {port_raw!r}")

    db_path = Path((os.environ.get("FACTORY_DB") or DEFAULT_FACTORY_DB).strip())
    seed_path = Path((os.environ.get("FACTORY_SEED_DB") or str(DEFAULT_SEED_DB)).strip())

    if not db_path.exists():
        db_path.parent.mkdir(parents=True, exist_ok=True)
        if seed_path.exists():
            tmp_path = db_path.with_name(f".{db_path.name}.tmp.{os.getpid()}")
            shutil.copyfile(seed_path, tmp_path)
            os.replace(tmp_path, db_path)

    env = dict(os.environ)
    env["FACTORY_DB"] = str(db_path)
    os.chdir(ROOT)

    argv = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "0.0.0.0",
        "--port",
        str(port),
        "--proxy-headers",
        "--forwarded-allow-ips=*",
    ]
    os.execvpe(sys.executable, argv, env)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
