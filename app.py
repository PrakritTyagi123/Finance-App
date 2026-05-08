"""
Khata — Flask entry point.

Phase 1: minimal scaffold. Initializes the SQLite database on startup,
exposes a /api/health endpoint to confirm the server runs, and wires
the per-request connection lifecycle.

Routes are added in Phase 2.
"""

from flask import Flask, jsonify

from backend.db import init_db, close_db


def create_app():
    app = Flask(__name__)

    # Initialize schema + run any pending migrations on startup
    with app.app_context():
        init_db()

    # Close DB connection at the end of each request
    app.teardown_appcontext(close_db)

    # ---- Health check (Phase 1 sanity) ---------------------------------
    @app.get("/api/health")
    def health():
        from backend.models import accounts, transactions, budgets
        return jsonify({
            "status": "ok",
            "phase": 1,
            "counts": {
                "accounts": accounts.count(),
                "transactions": transactions.count(),
                "budgets": len(budgets.all_budgets()),
            },
        })

    return app


# Module-level instance so `flask run` and `python app.py` both work
app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)