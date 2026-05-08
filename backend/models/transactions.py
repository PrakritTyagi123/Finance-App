"""
Khata — Transactions model
--------------------------
Phase 1: income + expense, atomic balance updates, filtering, aggregations.
Later phases will extend with: backdating (timestamp param on add),
edit, transfer pairs (transfer_id), recurring source (recurring_id).
"""

import json
import time
import secrets
from ..db import query_all, query_one, execute, transaction
from . import accounts as accounts_model


def _gen_id():
    return secrets.token_hex(6)


def _row_to_dict(row):
    if not row:
        return None
    try:
        tags = json.loads(row["tags"] or "[]")
    except (json.JSONDecodeError, TypeError):
        tags = []
    try:
        flag_reasons = json.loads(row["flag_reasons"] or "[]")
    except (json.JSONDecodeError, TypeError):
        flag_reasons = []

    return {
        "id": row["id"],
        "type": row["type"],
        "amount": float(row["amount"]),
        "category": row["category"],
        "accountId": row["account_id"],
        "tags": tags if isinstance(tags, list) else [],
        "note": row["note"] or "",
        "timestamp": int(row["timestamp"]),
        "flagged": bool(row["flagged"]),
        "flagReasons": flag_reasons if isinstance(flag_reasons, list) else [],
    }


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def get(tx_id):
    return _row_to_dict(query_one("SELECT * FROM transactions WHERE id = ?", (tx_id,)))


def all_transactions(limit=None):
    sql = "SELECT * FROM transactions ORDER BY timestamp DESC, id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [_row_to_dict(r) for r in query_all(sql)]


def count():
    row = query_one("SELECT COUNT(*) AS c FROM transactions")
    return int(row["c"]) if row else 0


def recent(limit=5):
    return [_row_to_dict(r) for r in query_all(
        "SELECT * FROM transactions ORDER BY timestamp DESC, id DESC LIMIT ?", (int(limit),)
    )]


def filtered(*, type=None, category=None, account_id=None, search=None, tag=None, limit=200):
    """Filter transactions. All params optional."""
    where, params = [], []

    if type:
        where.append("type = ?")
        params.append(type)
    if category:
        where.append("category = ?")
        params.append(category)
    if account_id:
        where.append("account_id = ?")
        params.append(account_id)
    if tag:
        where.append("LOWER(tags) LIKE ?")
        params.append(f'%"{tag.lower()}"%')
    if search:
        s = f"%{search.lower()}%"
        where.append("(LOWER(category) LIKE ? OR LOWER(note) LIKE ? OR LOWER(tags) LIKE ?)")
        params.extend([s, s, s])

    sql = "SELECT * FROM transactions"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY timestamp DESC, id DESC LIMIT ?"
    params.append(int(limit))

    return [_row_to_dict(r) for r in query_all(sql, params)]


def all_tags(limit=16):
    """Return tag frequency map → list of top tags."""
    rows = query_all("SELECT tags FROM transactions WHERE tags <> '[]'")
    counts = {}
    for r in rows:
        try:
            for t in json.loads(r["tags"] or "[]"):
                counts[t] = counts.get(t, 0) + 1
        except json.JSONDecodeError:
            continue
    ordered = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    return [t for t, _ in ordered[:limit]]


# ---------------------------------------------------------------------------
# Aggregations
# ---------------------------------------------------------------------------
def _start_of_month_ms():
    t = time.localtime()
    return int(time.mktime((t.tm_year, t.tm_mon, 1, 0, 0, 0, 0, 0, -1)) * 1000)


def totals_this_month():
    ms = _start_of_month_ms()
    row = query_one(
        """SELECT
             COALESCE(SUM(CASE WHEN type='income'  THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0) AS expense
           FROM transactions WHERE timestamp >= ?""",
        (ms,),
    )
    income = float(row["income"]) if row else 0.0
    expense = float(row["expense"]) if row else 0.0
    return {"income": income, "expense": expense, "net": income - expense}


def by_category_this_month(type="expense"):
    ms = _start_of_month_ms()
    rows = query_all(
        """SELECT category, SUM(amount) AS total
           FROM transactions
           WHERE type = ? AND timestamp >= ?
           GROUP BY category
           ORDER BY total DESC""",
        (type, ms),
    )
    return {r["category"]: float(r["total"]) for r in rows}


def daily_average_30_days():
    cutoff = int(time.time() * 1000) - 30 * 86_400_000
    row = query_one(
        """SELECT COALESCE(SUM(amount), 0) AS total
           FROM transactions
           WHERE type = 'expense' AND timestamp >= ?""",
        (cutoff,),
    )
    return (float(row["total"]) if row else 0.0) / 30


def last_n_days(days=14):
    """Returns [{day, income, expense}, ...] in ascending order."""
    today_ms = int(time.time() // 86400 * 86400 * 1000)
    first = today_ms - (days - 1) * 86_400_000

    buckets = []
    by_day = {}
    for i in range(days - 1, -1, -1):
        d = today_ms - i * 86_400_000
        bucket = {"day": d, "income": 0.0, "expense": 0.0}
        buckets.append(bucket)
        by_day[d] = bucket

    rows = query_all(
        """SELECT
             ((timestamp / 86400000) * 86400000) AS day,
             COALESCE(SUM(CASE WHEN type='income'  THEN amount END), 0) AS income,
             COALESCE(SUM(CASE WHEN type='expense' THEN amount END), 0) AS expense
           FROM transactions
           WHERE timestamp >= ?
           GROUP BY day
           ORDER BY day ASC""",
        (first,),
    )
    for r in rows:
        bucket = by_day.get(int(r["day"]))
        if bucket:
            bucket["income"] = float(r["income"])
            bucket["expense"] = float(r["expense"])
    return buckets


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def add(*, type, amount, category, account_id, tags=None, note="", timestamp=None,
        flagged=False, flag_reasons=None):
    """
    Add a transaction. Atomically updates the source account balance.
    `timestamp` is optional — defaults to now (Phase 4 will use it for backdating).
    """
    if type not in ("income", "expense"):
        raise ValueError("type must be 'income' or 'expense'")
    amount = float(amount)
    if amount <= 0:
        raise ValueError("amount must be positive")
    if not accounts_model.get(account_id):
        raise ValueError(f"Account {account_id!r} not found")

    tx_id = _gen_id()
    ts = int(timestamp) if timestamp else int(time.time() * 1000)
    tags_json = json.dumps([t for t in (tags or []) if t])
    flags_json = json.dumps(flag_reasons or [])

    with transaction():
        execute(
            """INSERT INTO transactions
               (id, type, amount, category, account_id, tags, note, timestamp, flagged, flag_reasons)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tx_id, type, amount, category, account_id,
             tags_json, note.strip(), ts, 1 if flagged else 0, flags_json),
        )
        delta = amount if type == "income" else -amount
        accounts_model.adjust_balance(account_id, delta)

    return get(tx_id)


def delete(tx_id):
    """Delete transaction and reverse its effect on the account balance."""
    tx = get(tx_id)
    if not tx:
        return False

    with transaction():
        delta = -tx["amount"] if tx["type"] == "income" else tx["amount"]
        accounts_model.adjust_balance(tx["accountId"], delta)
        execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    return True