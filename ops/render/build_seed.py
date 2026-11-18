"""Build the pre-seeded demo SQLite database during Docker image assembly."""

from contextlib import closing
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import SCHEMA, connect, transaction
from app.seed import seed


def main() -> int:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("FACTORY_SEED_DB", "/app/seed/factory.sqlite3"))
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect(str(target))) as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)
        with transaction(db):
            seed(db)
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        db.execute("VACUUM")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
