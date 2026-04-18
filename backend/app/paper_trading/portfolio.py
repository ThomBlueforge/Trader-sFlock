"""
Paper-trading portfolio.
Commission = 0.05% per side.
Fixed position size = position_size_pct × current_capital per trade.
Always in the market: on a new signal in the opposite direction the open
trade is closed and a new trade is immediately opened.
"""
from __future__ import annotations

import time
import uuid

from app.core.database import get_connection

COMMISSION = 0.0005  # 0.05 %


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fetch_portfolio(agent_id: str, conn) -> dict | None:
    row = conn.execute(
        "SELECT * FROM portfolios WHERE agent_id = ?", (agent_id,)
    ).fetchone()
    return dict(row) if row else None


# ── Public API ────────────────────────────────────────────────────────────────

def get_or_create_portfolio(
    agent_id: str,
    position_size_pct: float = 0.1,
    initial_capital: float = 10_000.0,
) -> dict:
    conn = get_connection()
    try:
        p = _fetch_portfolio(agent_id, conn)
        if p:
            return p

        pid = str(uuid.uuid4())
        now = int(time.time())
        conn.execute(
            """
            INSERT INTO portfolios (
                id, agent_id, initial_capital, current_capital,
                position, position_entry_price, position_size_pct, created_at
            ) VALUES (?, ?, ?, ?, 0, NULL, ?, ?)
            """,
            (pid, agent_id, initial_capital, initial_capital, position_size_pct, now),
        )
        conn.commit()
        return dict(conn.execute(
            "SELECT * FROM portfolios WHERE id = ?", (pid,)
        ).fetchone())
    finally:
        conn.close()


def apply_signal(agent_id: str, signal: str, price: float, ts: int) -> dict:
    """
    Apply a new BULL/SHORT signal to the portfolio.
    If already in the same direction: no-op.
    Otherwise: close open trade (book PnL), open new trade in signal direction.
    """
    conn = get_connection()
    try:
        p = _fetch_portfolio(agent_id, conn)
        if p is None:
            raise ValueError(f"No portfolio for agent {agent_id!r}. Call get_or_create_portfolio first.")

        direction = 1.0 if signal == "BULL" else -1.0
        current_dir = p["position"]

        if current_dir == direction:
            return p  # nothing to do

        capital = p["current_capital"]

        # ── Close existing trade ──────────────────────────────────────────────
        if current_dir != 0:
            open_trade = conn.execute(
                "SELECT * FROM trades WHERE portfolio_id = ? AND status = 'open' "
                "ORDER BY opened_at DESC LIMIT 1",
                (p["id"],),
            ).fetchone()
            if open_trade:
                open_trade = dict(open_trade)
                entry_px = p["position_entry_price"] or price
                qty      = open_trade["quantity"]
                pnl      = current_dir * (price - entry_px) * qty
                pnl     -= qty * entry_px * COMMISSION   # closing commission
                capital += pnl
                conn.execute(
                    "UPDATE trades SET exit_price=?, pnl=?, closed_at=?, status='closed' WHERE id=?",
                    (price, round(pnl, 4), ts, open_trade["id"]),
                )

        # ── Open new trade ────────────────────────────────────────────────────
        position_size  = capital * p["position_size_pct"]
        capital       -= position_size * COMMISSION       # opening commission
        qty            = position_size / max(price, 1e-9)
        tid            = str(uuid.uuid4())

        conn.execute(
            """
            INSERT INTO trades (
                id, portfolio_id, agent_id, signal,
                entry_price, exit_price, quantity, pnl,
                opened_at, closed_at, status
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, NULL, 'open')
            """,
            (tid, p["id"], agent_id, signal, price, qty, ts),
        )

        conn.execute(
            """
            UPDATE portfolios
            SET current_capital=?, position=?, position_entry_price=?
            WHERE agent_id=?
            """,
            (capital, direction, price, agent_id),
        )
        conn.commit()

        return dict(conn.execute(
            "SELECT * FROM portfolios WHERE agent_id=?", (agent_id,)
        ).fetchone())
    finally:
        conn.close()


def get_portfolio(agent_id: str) -> dict | None:
    conn = get_connection()
    try:
        return _fetch_portfolio(agent_id, conn)
    finally:
        conn.close()


def get_trades(agent_id: str, limit: int = 100) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM trades WHERE agent_id=? ORDER BY opened_at DESC LIMIT ?",
            (agent_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def reset_portfolio(agent_id: str) -> dict:
    conn = get_connection()
    try:
        p = _fetch_portfolio(agent_id, conn)
        if p is None:
            raise ValueError(f"No portfolio for agent {agent_id!r}.")
        conn.execute(
            """
            UPDATE portfolios
            SET current_capital=?, position=0, position_entry_price=NULL
            WHERE agent_id=?
            """,
            (p["initial_capital"], agent_id),
        )
        conn.execute("DELETE FROM trades WHERE agent_id=?", (agent_id,))
        conn.commit()
        return dict(conn.execute(
            "SELECT * FROM portfolios WHERE agent_id=?", (agent_id,)
        ).fetchone())
    finally:
        conn.close()
