"""
Khata — Budgets model
---------------------
Phase 1: monthly only. The schema already has a `period` column for Phase 9.
"""

import time
from ..db import query_all, query_one, execute


VALID_PERIODS = ("weekly", "monthly", "quarterly", "yearly")


def _row_to_dict(row):
    if not row:
        return None
    return {
        "category": row["category"],
        "limit": float(row["limit_amount"]),
        "period": row["period"] or "monthly",
    }


def all_budgets():
    return [_row_to_dict(r) for r in query_all(
        "SELECT * FROM budgets ORDER BY category ASC"
    )]


def get(category):
    return _row_to_dict(query_one("SELECT * FROM budgets WHERE category = ?", (category,)))


def set_budget(category, limit, period="monthly"):
    if not category:
        raise ValueError("category required")
    limit = float(limit)
    if limit <= 0:
        raise ValueError("limit must be positive")
    if period not in VALID_PERIODS:
        raise ValueError(f"period must be one of {VALID_PERIODS}")

    execute(
        """INSERT INTO budgets (category, limit_amount, period)
           VALUES (?, ?, ?)
           ON CONFLICT(category) DO UPDATE
           SET limit_amount = excluded.limit_amount,
               period       = excluded.period""",
        (category, limit, period),
    )
    return get(category)


def remove(category):
    execute("DELETE FROM budgets WHERE category = ?", (category,))


# ---------------------------------------------------------------------------
# Spent calculation — period-aware
# ---------------------------------------------------------------------------
def _period_start_ms(period):
    """Return ms timestamp for the start of the current period."""
    now = time.localtime()

    if period == "weekly":
        # Week starts Monday
        today = time.mktime((now.tm_year, now.tm_mon, now.tm_mday, 0, 0, 0, 0, 0, -1))
        return int((today - now.tm_wday * 86400) * 1000)

    if period == "monthly":
        return int(time.mktime((now.tm_year, now.tm_mon, 1, 0, 0, 0, 0, 0, -1)) * 1000)

    if period == "quarterly":
        q_start_month = ((now.tm_mon - 1) // 3) * 3 + 1
        return int(time.mktime((now.tm_year, q_start_month, 1, 0, 0, 0, 0, 0, -1)) * 1000)

    if period == "yearly":
        return int(time.mktime((now.tm_year, 1, 1, 0, 0, 0, 0, 0, -1)) * 1000)

    return int(time.mktime((now.tm_year, now.tm_mon, 1, 0, 0, 0, 0, 0, -1)) * 1000)


def spent(category, period="monthly"):
    start = _period_start_ms(period)
    row = query_one(
        """SELECT COALESCE(SUM(amount), 0) AS total
           FROM transactions
           WHERE type = 'expense' AND category = ? AND timestamp >= ?""",
        (category, start),
    )
    return float(row["total"]) if row else 0.0


def status(category):
    """Return {limit, period, used, pct, level} for a category."""
    b = get(category)
    if not b:
        return None
    used = spent(category, b["period"])
    pct = (used / b["limit"]) * 100 if b["limit"] > 0 else 0
    level = "danger" if pct >= 100 else "warn" if pct >= 80 else "safe"
    return {
        "category": category,
        "limit": b["limit"],
        "period": b["period"],
        "used": used,
        "pct": pct,
        "level": level,
    }