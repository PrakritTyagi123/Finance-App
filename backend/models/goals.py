"""Khata — Goals model. Schema + CRUD; chart math built in Phase 10."""

import time
import secrets
from ..db import query_all, query_one, execute


def _gen_id():
    return secrets.token_hex(6)


def _row_to_dict(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "targetAmount": float(row["target_amount"]),
        "currentAmount": float(row["current_amount"]),
        "deadline": int(row["deadline"]) if row["deadline"] else None,
        "accountId": row["account_id"],
        "createdAt": int(row["created_at"]),
    }


def all_goals():
    return [_row_to_dict(r) for r in query_all("SELECT * FROM goals ORDER BY created_at DESC")]


def get(goal_id):
    return _row_to_dict(query_one("SELECT * FROM goals WHERE id = ?", (goal_id,)))


def create(*, name, target_amount, deadline=None, account_id=None, current_amount=0):
    if not name or not name.strip():
        raise ValueError("Goal name is required")
    target = float(target_amount)
    if target <= 0:
        raise ValueError("target_amount must be positive")

    goal_id = _gen_id()
    execute(
        """INSERT INTO goals
           (id, name, target_amount, current_amount, deadline, account_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (goal_id, name.strip(), target, float(current_amount),
         int(deadline) if deadline else None,
         account_id, int(time.time() * 1000)),
    )
    return get(goal_id)


def update_progress(goal_id, current_amount):
    execute("UPDATE goals SET current_amount = ? WHERE id = ?",
            (float(current_amount), goal_id))


def delete(goal_id):
    execute("DELETE FROM goals WHERE id = ?", (goal_id,))