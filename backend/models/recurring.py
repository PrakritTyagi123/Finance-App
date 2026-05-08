"""
Khata — Recurring transactions model
------------------------------------
Phase 1: schema + basic CRUD. The engine that fires due recurrences
lives in services/recurring_engine.py (built in Phase 7).
"""

import time
import secrets
from ..db import query_all, query_one, execute


VALID_FREQUENCIES = ("weekly", "monthly")


def _gen_id():
    return secrets.token_hex(6)


def _row_to_dict(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "type": row["type"],
        "amount": float(row["amount"]),
        "category": row["category"],
        "accountId": row["account_id"],
        "transferToId": row["transfer_to_id"],
        "note": row["note"] or "",
        "frequency": row["frequency"],
        "startDate": int(row["start_date"]),
        "nextDue": int(row["next_due"]),
        "lastFired": int(row["last_fired"]) if row["last_fired"] else None,
        "active": bool(row["active"]),
    }


def all_recurring(active_only=False):
    sql = "SELECT * FROM recurring"
    if active_only:
        sql += " WHERE active = 1"
    sql += " ORDER BY next_due ASC"
    return [_row_to_dict(r) for r in query_all(sql)]


def get(rec_id):
    return _row_to_dict(query_one("SELECT * FROM recurring WHERE id = ?", (rec_id,)))


def create(*, type, amount, category, account_id, frequency,
           start_date=None, transfer_to_id=None, note=""):
    if frequency not in VALID_FREQUENCIES:
        raise ValueError(f"frequency must be one of {VALID_FREQUENCIES}")

    rec_id = _gen_id()
    start = int(start_date) if start_date else int(time.time() * 1000)

    execute(
        """INSERT INTO recurring
           (id, type, amount, category, account_id, transfer_to_id,
            note, frequency, start_date, next_due, last_fired, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)""",
        (rec_id, type, float(amount), category, account_id,
         transfer_to_id, note, frequency, start, start),
    )
    return get(rec_id)


def update_next_due(rec_id, next_due, last_fired=None):
    if last_fired is not None:
        execute("UPDATE recurring SET next_due = ?, last_fired = ? WHERE id = ?",
                (int(next_due), int(last_fired), rec_id))
    else:
        execute("UPDATE recurring SET next_due = ? WHERE id = ?",
                (int(next_due), rec_id))


def set_active(rec_id, active):
    execute("UPDATE recurring SET active = ? WHERE id = ?", (1 if active else 0, rec_id))


def delete(rec_id):
    execute("DELETE FROM recurring WHERE id = ?", (rec_id,))