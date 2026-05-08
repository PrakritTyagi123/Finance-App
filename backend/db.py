"""
Khata — Database layer
----------------------
Single SQLite file. Connection-per-request via Flask's `g`, falling back to
a thread-local connection for non-Flask contexts (REPL, scripts, tests).

Schema is created on first run; future phases add columns via the
MIGRATIONS list below — each entry is an idempotent SQL block.
"""

import os
import sqlite3
import threading
from contextlib import contextmanager

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DB_PATH = os.environ.get(
    "KHATA_DB",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "khata.db"),
)

# Thread-local fallback (for REPL / scripts where Flask's `g` doesn't exist)
_local = threading.local()


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------
def _new_connection():
    conn = sqlite3.connect(DB_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def get_db():
    """Return the current connection. Uses Flask's `g` if available."""
    try:
        from flask import g, has_app_context
        if has_app_context():
            if "db" not in g:
                g.db = _new_connection()
            return g.db
    except ImportError:
        pass

    # Fallback: thread-local
    if not hasattr(_local, "db") or _local.db is None:
        _local.db = _new_connection()
    return _local.db


def close_db(_=None):
    """Close the current connection, if any."""
    try:
        from flask import g, has_app_context
        if has_app_context():
            db = g.pop("db", None)
            if db is not None:
                db.close()
            return
    except ImportError:
        pass

    db = getattr(_local, "db", None)
    if db is not None:
        db.close()
        _local.db = None


@contextmanager
def transaction():
    """Use as `with transaction(): ...` for atomic multi-statement writes."""
    db = get_db()
    try:
        db.execute("BEGIN")
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
def query_all(sql, params=()):
    return [dict(r) for r in get_db().execute(sql, params).fetchall()]


def query_one(sql, params=()):
    row = get_db().execute(sql, params).fetchone()
    return dict(row) if row else None


def execute(sql, params=()):
    cur = get_db().execute(sql, params)
    get_db().commit()
    return cur


def executemany(sql, seq):
    cur = get_db().executemany(sql, seq)
    get_db().commit()
    return cur


# ---------------------------------------------------------------------------
# Schema — base tables
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('bank', 'wallet', 'cash')),
    balance     REAL NOT NULL DEFAULT 0,
    min_balance REAL NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id            TEXT PRIMARY KEY,
    type          TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount        REAL NOT NULL CHECK (amount > 0),
    category      TEXT NOT NULL,
    account_id    TEXT NOT NULL,
    tags          TEXT NOT NULL DEFAULT '[]',
    note          TEXT NOT NULL DEFAULT '',
    timestamp     INTEGER NOT NULL,
    flagged       INTEGER NOT NULL DEFAULT 0,
    flag_reasons  TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tx_timestamp ON transactions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tx_type      ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_category  ON transactions(category);
CREATE INDEX IF NOT EXISTS idx_tx_account   ON transactions(account_id);

CREATE TABLE IF NOT EXISTS budgets (
    category     TEXT PRIMARY KEY,
    limit_amount REAL NOT NULL CHECK (limit_amount > 0),
    period       TEXT NOT NULL DEFAULT 'monthly'
);

CREATE TABLE IF NOT EXISTS recurring (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL,
    amount           REAL NOT NULL,
    category         TEXT NOT NULL,
    account_id       TEXT NOT NULL,
    transfer_to_id   TEXT,
    note             TEXT NOT NULL DEFAULT '',
    frequency        TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
    start_date       INTEGER NOT NULL,
    next_due         INTEGER NOT NULL,
    last_fired       INTEGER,
    active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS goals (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    target_amount  REAL NOT NULL CHECK (target_amount > 0),
    current_amount REAL NOT NULL DEFAULT 0,
    deadline       INTEGER,
    account_id     TEXT,
    created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshots (
    date         INTEGER PRIMARY KEY,
    net_worth    REAL NOT NULL,
    total_assets REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS migrations (
    name       TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
);
"""

# ---------------------------------------------------------------------------
# Migrations — additive only. Each is run once and recorded in `migrations`.
# Future phases append here. Phase 1 needs none — schema is current.
# ---------------------------------------------------------------------------
MIGRATIONS = [
    # Example for later phases:
    # ("001_add_transfer_id", "ALTER TABLE transactions ADD COLUMN transfer_id TEXT"),
    # ("002_add_recurring_id", "ALTER TABLE transactions ADD COLUMN recurring_id TEXT"),
]


def init_db():
    """Create schema and apply any pending migrations. Idempotent."""
    db = get_db()
    db.executescript(SCHEMA)

    applied = {r["name"] for r in db.execute("SELECT name FROM migrations").fetchall()}
    import time

    for name, sql in MIGRATIONS:
        if name in applied:
            continue
        try:
            db.executescript(sql)
            db.execute(
                "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
                (name, int(time.time() * 1000)),
            )
            db.commit()
            print(f"  · applied migration: {name}")
        except sqlite3.OperationalError as e:
            # ALTER TABLE will throw if column already exists — record it anyway
            if "duplicate column" in str(e).lower():
                db.execute(
                    "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
                    (name, int(time.time() * 1000)),
                )
                db.commit()
            else:
                raise


def reset_db():
    """Drop all data. Used by /api/reset and tests."""
    with transaction() as db:
        db.execute("DELETE FROM transactions")
        db.execute("DELETE FROM budgets")
        db.execute("DELETE FROM accounts")
        db.execute("DELETE FROM recurring")
        db.execute("DELETE FROM goals")
        db.execute("DELETE FROM snapshots")