"""Khata — Accounts model. CRUD + balance helpers."""

import time
import secrets
from ..db import query_all, query_one, execute


VALID_TYPES = ("bank", "wallet", "cash")


def _gen_id():
    return secrets.token_hex(6)


def _row_to_dict(row):
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "balance": float(row["balance"]),
        "minBalance": float(row["min_balance"]),
        "createdAt": int(row["created_at"]),
    }


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------
def all_accounts():
    return [_row_to_dict(r) for r in query_all(
        "SELECT * FROM accounts ORDER BY created_at ASC"
    )]


def get(account_id):
    return _row_to_dict(query_one("SELECT * FROM accounts WHERE id = ?", (account_id,)))


def count():
    row = query_one("SELECT COUNT(*) AS c FROM accounts")
    return int(row["c"]) if row else 0


def total_net_worth():
    row = query_one("SELECT COALESCE(SUM(balance), 0) AS total FROM accounts")
    return float(row["total"]) if row else 0.0


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------
def create(*, name, type, balance=0, min_balance=0):
    if not name or not name.strip():
        raise ValueError("Account name is required")
    if type not in VALID_TYPES:
        raise ValueError(f"Account type must be one of {VALID_TYPES}")

    acc_id = _gen_id()
    execute(
        """INSERT INTO accounts (id, name, type, balance, min_balance, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (acc_id, name.strip(), type, float(balance), float(min_balance), int(time.time() * 1000)),
    )
    return get(acc_id)


def update(account_id, *, name=None, type=None, balance=None, min_balance=None):
    existing = get(account_id)
    if not existing:
        return None

    new_name = name.strip() if name is not None else existing["name"]
    new_type = type if type is not None else existing["type"]
    new_balance = float(balance) if balance is not None else existing["balance"]
    new_min = float(min_balance) if min_balance is not None else existing["minBalance"]

    if new_type not in VALID_TYPES:
        raise ValueError(f"Account type must be one of {VALID_TYPES}")

    execute(
        """UPDATE accounts
           SET name = ?, type = ?, balance = ?, min_balance = ?
           WHERE id = ?""",
        (new_name, new_type, new_balance, new_min, account_id),
    )
    return get(account_id)


def adjust_balance(account_id, delta):
    """Apply a signed delta to the account balance. Used by transactions."""
    execute("UPDATE accounts SET balance = balance + ? WHERE id = ?", (float(delta), account_id))


def delete(account_id):
    """Delete account; CASCADE removes its transactions."""
    execute("DELETE FROM accounts WHERE id = ?", (account_id,))


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
def is_low(acc):
    return acc["minBalance"] > 0 and acc["balance"] < acc["minBalance"]


def is_near_low(acc):
    return acc["minBalance"] > 0 and not is_low(acc) and acc["balance"] < acc["minBalance"] * 1.25