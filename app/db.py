"""SQLite storage and transaction primitives for the factory."""

import hashlib
import hmac
import os
import secrets
import sqlite3
import unicodedata
from contextlib import contextmanager
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
MOSCOW = ZoneInfo("Europe/Moscow")
STAGES = {"cut": "Раскрой", "sew": "Пошив", "pack": "Упаковка"}
WAREHOUSES = {"raw": 1, "cut": 2, "sew": 3, "pack": 4, "finished": 5}

SCHEMA = """
CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL,
    kind TEXT NOT NULL, UNIQUE(name, city)
);
CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('raw','product')), sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, size TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL,
    category TEXT NOT NULL, price INTEGER NOT NULL CHECK(price >= 0)
);
CREATE TABLE IF NOT EXISTS staff (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, stage TEXT NOT NULL, position TEXT NOT NULL,
    hired_on TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    travel_eligible INTEGER NOT NULL DEFAULT 0, travel_amount INTEGER NOT NULL DEFAULT 0 CHECK(travel_amount >= 0)
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','accountant','master','regional')), staff_id INTEGER UNIQUE REFERENCES staff(id)
);
CREATE TABLE IF NOT EXISTS grants (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    granted_at TEXT NOT NULL, granted_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
    digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS specs (
    id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES items(id),
    version INTEGER NOT NULL, effective TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    UNIQUE(product_id, version)
);
CREATE TABLE IF NOT EXISTS norms (
    spec_id INTEGER NOT NULL REFERENCES specs(id), item_id INTEGER NOT NULL REFERENCES items(id),
    stage TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), PRIMARY KEY(spec_id,item_id,stage)
);
CREATE TABLE IF NOT EXISTS rates (
    spec_id INTEGER NOT NULL REFERENCES specs(id), stage TEXT NOT NULL, amount INTEGER NOT NULL,
    PRIMARY KEY(spec_id,stage)
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL,
    date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id),
    stage TEXT, shift TEXT, source_id INTEGER REFERENCES warehouses(id), target_id INTEGER REFERENCES warehouses(id),
    memo TEXT NOT NULL DEFAULT '', supplier TEXT, reference TEXT, payment TEXT, source_doc INTEGER REFERENCES documents(id),
    UNIQUE(kind,code)
);
CREATE INDEX IF NOT EXISTS documents_kind_date ON documents(kind,date);
CREATE TABLE IF NOT EXISTS lines (
    id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id),
    item_id INTEGER NOT NULL REFERENCES items(id), quantity INTEGER NOT NULL CHECK(quantity > 0),
    price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0), spec_id INTEGER REFERENCES specs(id),
    prepared INTEGER NOT NULL DEFAULT 0, book_value INTEGER NOT NULL DEFAULT 0,
    UNIQUE(doc_id,item_id)
);
CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL REFERENCES lines(id),
    staff_id INTEGER NOT NULL REFERENCES staff(id), quantity INTEGER NOT NULL CHECK(quantity > 0),
    rate INTEGER NOT NULL CHECK(rate >= 0), UNIQUE(line_id,staff_id)
);
CREATE TABLE IF NOT EXISTS material_snapshots (
    line_id INTEGER NOT NULL REFERENCES lines(id), item_id INTEGER NOT NULL REFERENCES items(id),
    norm INTEGER NOT NULL, quantity INTEGER NOT NULL, value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(line_id,item_id)
);
CREATE TABLE IF NOT EXISTS balances (
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), item_id INTEGER NOT NULL REFERENCES items(id),
    quantity INTEGER NOT NULL CHECK(quantity >= 0), value INTEGER NOT NULL CHECK(value >= 0),
    PRIMARY KEY(warehouse_id,item_id), CHECK(quantity != 0 OR value = 0)
);
CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY, warehouse_id INTEGER NOT NULL REFERENCES warehouses(id), item_id INTEGER NOT NULL REFERENCES items(id),
    doc_id INTEGER NOT NULL REFERENCES documents(id), happened_at TEXT NOT NULL, operation TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity != 0), value INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS movement_history ON movements(warehouse_id,happened_at,id);
CREATE INDEX IF NOT EXISTS movement_document ON movements(doc_id);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id), actor_id INTEGER NOT NULL REFERENCES users(id),
    happened_at TEXT NOT NULL, action TEXT NOT NULL, memo TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS hourly_works (
    id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL REFERENCES documents(id),
    staff_id INTEGER NOT NULL REFERENCES staff(id), work_type TEXT NOT NULL DEFAULT 'loader',
    minutes INTEGER NOT NULL CHECK(minutes > 0), hourly_rate INTEGER NOT NULL CHECK(hourly_rate >= 0),
    amount INTEGER NOT NULL CHECK(amount >= 0), UNIQUE(doc_id, staff_id, work_type)
);
CREATE INDEX IF NOT EXISTS hourly_works_doc ON hourly_works(doc_id);
CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id INTEGER PRIMARY KEY, month TEXT NOT NULL, staff_id INTEGER NOT NULL REFERENCES staff(id),
    travel INTEGER CHECK(travel IS NULL OR travel >= 0),
    debt INTEGER NOT NULL DEFAULT 0 CHECK(debt >= 0),
    advance INTEGER NOT NULL DEFAULT 0 CHECK(advance >= 0),
    ndfl INTEGER NOT NULL DEFAULT 0 CHECK(ndfl >= 0),
    memo TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
    updated_by INTEGER REFERENCES users(id), UNIQUE(month, staff_id)
);
CREATE TABLE IF NOT EXISTS overhead (
    month TEXT PRIMARY KEY, amount INTEGER NOT NULL CHECK(amount >= 0), details TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""


def migrate(db):
    """Idempotent schema migration for existing SQLite databases."""
    staff_cols = {row["name"] for row in db.execute("PRAGMA table_info(staff)")}
    if "travel_eligible" not in staff_cols:
        db.execute("ALTER TABLE staff ADD COLUMN travel_eligible INTEGER NOT NULL DEFAULT 0")
    if "travel_amount" not in staff_cols:
        db.execute("ALTER TABLE staff ADD COLUMN travel_amount INTEGER NOT NULL DEFAULT 0")
    spec_cols = {row["name"] for row in db.execute("PRAGMA table_info(specs)")}
    if "name" not in spec_cols:
        db.execute("ALTER TABLE specs ADD COLUMN name TEXT NOT NULL DEFAULT ''")
    db.execute("UPDATE specs SET name = 'Спецификация ' || version WHERE TRIM(COALESCE(name, '')) = ''")
    db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('loader_rate', '6000')")


def now():
    return datetime.now(MOSCOW).isoformat(timespec="seconds")


def today():
    return now()[:10]


def search_text(value):
    return unicodedata.normalize("NFKC",str(value or "")).casefold().replace("ё","е")


def matches_search(query, *columns):
    values=tuple(search_text(value) for value in columns)
    return all(any(word in value for value in values) for word in search_text(query).split())


def connect(path=None):
    file = Path(path or os.environ.get("FACTORY_DB", ROOT / "data" / "factory.sqlite3"))
    file.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(file, timeout=12, check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.create_function("search_text",1,search_text,deterministic=True)
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA busy_timeout = 12000")
    return db


@contextmanager
def transaction(db):
    db.execute("BEGIN IMMEDIATE")
    try:
        yield
        db.commit()
    except BaseException:
        db.rollback()
        raise


def records(db, sql, args=()):
    return [dict(row) for row in db.execute(sql, args)]


def record(db, sql, args=()):
    row = db.execute(sql, args).fetchone()
    return dict(row) if row else None


def scalar(db, sql, args=()):
    return db.execute(sql, args).fetchone()[0]


def to_units(value, factor=1000):
    result = Decimal(str(value)) * factor
    if result != result.to_integral_value():
        raise ValueError("Слишком много знаков после запятой")
    return int(result)


def rounded(numerator, denominator):
    return int((Decimal(numerator) / denominator).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def line_cost(quantity, unit_price):
    return rounded(quantity * unit_price, 1000)


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()
    return f"{salt}:{digest}"


def password_matches(password, stored):
    return hmac.compare_digest(password_hash(password, stored.split(":", 1)[0]), stored)
