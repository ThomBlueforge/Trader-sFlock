"""
Synchronous SQLite CRUD for the agents and agent_models tables.
All functions are called via asyncio.to_thread() from the async API layer.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid

from app.core.database import get_connection
from app.schemas import AgentCreate, AgentOut, AgentUpdate


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_agent(row: sqlite3.Row) -> AgentOut:
    return AgentOut(
        id=row["id"],
        name=row["name"],
        color=row["color"],
        timeframe=row["timeframe"],
        features=json.loads(row["features_json"]),
        model_type=row["model_type"],
        hyperparams=json.loads(row["hyperparams_json"]),
        target_horizon=row["target_horizon"],
        target_threshold=row["target_threshold"],
        train_window=row["train_window"],
        position_size_pct=row["position_size_pct"],
        status=row["status"],
        metrics=json.loads(row["metrics_json"]) if row["metrics_json"] else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


# ── CRUD ──────────────────────────────────────────────────────────────────────

def create_agent(data: AgentCreate) -> AgentOut:
    agent_id = str(uuid.uuid4())
    now = int(time.time())
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT INTO agents (
                id, name, color, timeframe, features_json, model_type,
                hyperparams_json, target_horizon, target_threshold,
                train_window, position_size_pct, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)
            """,
            (
                agent_id, data.name, data.color, data.timeframe,
                json.dumps(data.features), data.model_type,
                json.dumps(data.hyperparams), data.target_horizon,
                data.target_threshold, data.train_window,
                data.position_size_pct, now, now,
            ),
        )
        conn.commit()
        return get_agent(agent_id)  # type: ignore[return-value]
    finally:
        conn.close()


def get_agent(agent_id: str) -> AgentOut | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM agents WHERE id = ?", (agent_id,)
        ).fetchone()
        return _row_to_agent(row) if row else None
    finally:
        conn.close()


def list_agents() -> list[AgentOut]:
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM agents ORDER BY created_at DESC"
        ).fetchall()
        return [_row_to_agent(r) for r in rows]
    finally:
        conn.close()


def update_agent(agent_id: str, data: AgentUpdate) -> AgentOut | None:
    updates: dict = {}
    if data.name             is not None: updates["name"]              = data.name
    if data.color            is not None: updates["color"]             = data.color
    if data.features         is not None: updates["features_json"]     = json.dumps(data.features)
    if data.model_type       is not None: updates["model_type"]        = data.model_type
    if data.hyperparams      is not None: updates["hyperparams_json"]  = json.dumps(data.hyperparams)
    if data.target_horizon   is not None: updates["target_horizon"]    = data.target_horizon
    if data.target_threshold is not None: updates["target_threshold"]  = data.target_threshold
    if data.train_window     is not None: updates["train_window"]      = data.train_window
    if data.position_size_pct is not None: updates["position_size_pct"] = data.position_size_pct

    if not updates:
        return get_agent(agent_id)

    updates["updated_at"] = int(time.time())
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [agent_id]

    conn = get_connection()
    try:
        conn.execute(f"UPDATE agents SET {set_clause} WHERE id = ?", values)
        conn.commit()
        return get_agent(agent_id)
    finally:
        conn.close()


def delete_agent(agent_id: str) -> bool:
    conn = get_connection()
    try:
        c = conn.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
        conn.commit()
        return c.rowcount > 0
    finally:
        conn.close()


def set_agent_status(
    agent_id: str,
    status: str,
    metrics: dict | None = None,
) -> None:
    now = int(time.time())
    conn = get_connection()
    try:
        if metrics is not None:
            conn.execute(
                "UPDATE agents SET status = ?, metrics_json = ?, updated_at = ? WHERE id = ?",
                (status, json.dumps(metrics), now, agent_id),
            )
        else:
            conn.execute(
                "UPDATE agents SET status = ?, updated_at = ? WHERE id = ?",
                (status, now, agent_id),
            )
        conn.commit()
    finally:
        conn.close()


# ── Model blob ────────────────────────────────────────────────────────────────

def save_model_blob(
    agent_id: str,
    model_bytes: bytes,
    feature_names: list[str],
) -> None:
    now = int(time.time())
    conn = get_connection()
    try:
        conn.execute(
            """
            INSERT OR REPLACE INTO agent_models
                (agent_id, model_blob, feature_names_json, trained_at)
            VALUES (?, ?, ?, ?)
            """,
            (agent_id, model_bytes, json.dumps(feature_names), now),
        )
        conn.commit()
    finally:
        conn.close()


def load_model_blob(agent_id: str) -> tuple[bytes, list[str]] | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT model_blob, feature_names_json FROM agent_models WHERE agent_id = ?",
            (agent_id,),
        ).fetchone()
        if row is None:
            return None
        return bytes(row["model_blob"]), json.loads(row["feature_names_json"])
    finally:
        conn.close()
