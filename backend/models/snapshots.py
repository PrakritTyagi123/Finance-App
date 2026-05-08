"""Khata — Net worth daily snapshots. Engine in services/snapshot_engine.py (Phase 10)."""

import time
from ..db import query_all, query_one, execute
from . import accounts as accounts_model


def _today_start_ms():
    t = time.localtime()
    return int(time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1)) * 1000)


def all_snapshots(limit=None):
    sql = "SELECT * FROM snapshots ORDER BY date ASC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [
        {"date": int(r["date"]),
         "netWorth": float(r["net_worth"]),
         "totalAssets": float(r["total_assets"])}
        for r in query_all(sql)
    ]


def get_today():
    row = query_one("SELECT * FROM snapshots WHERE date = ?", (_today_start_ms(),))
    if not row:
        return None
    return {"date": int(row["date"]),
            "netWorth": float(row["net_worth"]),
            "totalAssets": float(row["total_assets"])}


def record_today():
    """Idempotent: writes / updates today's net worth snapshot."""
    today = _today_start_ms()
    accs = accounts_model.all_accounts()
    net = sum(a["balance"] for a in accs)
    assets = sum(a["balance"] for a in accs if a["balance"] > 0)

    execute(
        """INSERT INTO snapshots (date, net_worth, total_assets)
           VALUES (?, ?, ?)
           ON CONFLICT(date) DO UPDATE
           SET net_worth    = excluded.net_worth,
               total_assets = excluded.total_assets""",
        (today, net, assets),
    )
    return {"date": today, "netWorth": net, "totalAssets": assets}