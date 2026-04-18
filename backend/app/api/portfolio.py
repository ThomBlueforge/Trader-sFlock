"""
Portfolio endpoints.
  GET  /api/portfolio/summary/all          → list[PortfolioOut]
  GET  /api/portfolio/{agent_id}           → PortfolioOut
  GET  /api/portfolio/{agent_id}/trades    → list[TradeOut]
  GET  /api/portfolio/{agent_id}/equity    → list[{ts, equity}]
  POST /api/portfolio/{agent_id}/reset     → PortfolioOut

Route ordering: /summary/all MUST precede /{agent_id}.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.core.database import get_connection
from app.paper_trading.portfolio import (
    get_portfolio,
    get_trades,
    reset_portfolio,
)
from app.schemas import PortfolioOut, TradeOut

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_latest_gold_price() -> float:
    """Fetch the most recent GC=F close across all timeframes for open-PnL calc."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT close FROM price_data WHERE symbol='GC=F' ORDER BY ts DESC LIMIT 1"
        ).fetchone()
        return float(row["close"]) if row else 0.0
    finally:
        conn.close()


def _to_out(p: dict, current_price: float = 0.0) -> PortfolioOut:
    initial = p["initial_capital"]
    current = p["current_capital"]
    total_return_pct = (current / initial - 1.0) if initial > 0 else 0.0

    position  = p["position"]
    entry_px  = p.get("position_entry_price") or 0.0
    open_pnl  = 0.0
    if position != 0 and entry_px > 0 and current_price > 0:
        pos_value = current * p["position_size_pct"]
        qty       = pos_value / entry_px
        open_pnl  = position * (current_price - entry_px) * qty

    return PortfolioOut(
        id=p["id"],
        agent_id=p["agent_id"],
        initial_capital=initial,
        current_capital=current,
        position=position,
        position_entry_price=p.get("position_entry_price"),
        position_size_pct=p["position_size_pct"],
        created_at=p["created_at"],
        total_return_pct=round(total_return_pct, 4),
        open_pnl=round(open_pnl, 4),
    )


# ── Routes ────────────────────────────────────────────────────────────────────

# MUST be before /{agent_id}
@router.get("/summary/all")
async def get_all_portfolios() -> list[PortfolioOut]:
    current_price = await asyncio.to_thread(_get_latest_gold_price)

    def _fetch() -> list[PortfolioOut]:
        conn = get_connection()
        try:
            rows = conn.execute("SELECT * FROM portfolios").fetchall()
            return [_to_out(dict(r), current_price) for r in rows]
        finally:
            conn.close()

    return await asyncio.to_thread(_fetch)


@router.get("/{agent_id}")
async def get_agent_portfolio(agent_id: str) -> PortfolioOut:
    p = await asyncio.to_thread(get_portfolio, agent_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    current_price = await asyncio.to_thread(_get_latest_gold_price)
    return _to_out(p, current_price)


@router.get("/{agent_id}/trades")
async def get_agent_trades(agent_id: str, limit: int = 100) -> list[TradeOut]:
    trades = await asyncio.to_thread(get_trades, agent_id, limit)
    return [TradeOut(**t) for t in trades]


@router.get("/{agent_id}/equity")
async def get_equity_curve(agent_id: str) -> list[dict]:
    p = await asyncio.to_thread(get_portfolio, agent_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    def _compute(portfolio: dict) -> list[dict]:
        conn = get_connection()
        try:
            rows = conn.execute(
                "SELECT pnl, closed_at, opened_at FROM trades "
                "WHERE agent_id=? AND status='closed' ORDER BY opened_at ASC",
                (portfolio["agent_id"],),
            ).fetchall()
            capital = portfolio["initial_capital"]
            points: list[dict] = [
                {"ts": portfolio["created_at"] * 1000, "equity": round(capital, 2)}
            ]
            for row in rows:
                if row["pnl"] is not None:
                    capital += row["pnl"]
                    ts_ms = (row["closed_at"] or row["opened_at"]) * 1000
                    points.append({"ts": ts_ms, "equity": round(capital, 2)})
            return points
        finally:
            conn.close()

    return await asyncio.to_thread(_compute, p)


@router.post("/{agent_id}/reset")
async def reset_agent_portfolio(agent_id: str) -> PortfolioOut:
    try:
        p = await asyncio.to_thread(reset_portfolio, agent_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _to_out(p)
