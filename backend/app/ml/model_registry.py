"""
Append-only model version store.
Every training run writes a new row to model_versions.
Only one row per agent has is_active=1.
rollback_to_version() swaps the active flag.
purge_old_versions() keeps at most MAX_VERSIONS per agent.
"""
from __future__ import annotations

import json
import time
import uuid

from app.core.database import get_connection

MAX_VERSIONS = 10


# ── Write ──────────────────────────────────────────────────────────────────────

def save_model_version(
    agent_id:     str,
    model_bytes:  bytes,
    feature_names: list[str],
    hyperparams:  dict,
    metrics:      dict | None = None,
) -> int:
    """
    Insert a new model version, mark it active, deactivate previous.
    Returns the new version number.
    """
    conn = get_connection()
    try:
        # Get next version number
        row = conn.execute(
            "SELECT MAX(version) FROM model_versions WHERE agent_id = ?",
            (agent_id,),
        ).fetchone()
        next_ver = (row[0] or 0) + 1

        ver_id = str(uuid.uuid4())
        now    = int(time.time())

        # Deactivate previous active version
        conn.execute(
            "UPDATE model_versions SET is_active = 0 WHERE agent_id = ?",
            (agent_id,),
        )

        conn.execute(
            """
            INSERT INTO model_versions
                (id, agent_id, version, model_blob, feature_names_json,
                 hyperparams_json, metrics_json, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            """,
            (
                ver_id, agent_id, next_ver, model_bytes,
                json.dumps(feature_names),
                json.dumps(hyperparams),
                json.dumps(metrics) if metrics else None,
                now,
            ),
        )
        conn.commit()
        purge_old_versions(agent_id, conn=conn)
        return next_ver
    finally:
        conn.close()


def purge_old_versions(agent_id: str, conn=None, keep: int = MAX_VERSIONS) -> None:
    """Delete oldest versions beyond the keep limit (never delete active)."""
    _close = conn is None
    if conn is None:
        conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id FROM model_versions
            WHERE agent_id = ? AND is_active = 0
            ORDER BY version DESC
            """,
            (agent_id,),
        ).fetchall()
        # keep the most recent (keep - 1) inactive; delete the rest
        to_delete = [r["id"] for r in rows[keep - 1:]]
        if to_delete:
            placeholders = ",".join("?" * len(to_delete))
            conn.execute(
                f"DELETE FROM model_versions WHERE id IN ({placeholders})",
                to_delete,
            )
            conn.commit()
    finally:
        if _close:
            conn.close()


# ── Read ───────────────────────────────────────────────────────────────────────

def load_active_model(agent_id: str) -> tuple[bytes, list[str]] | None:
    """Return (model_blob, feature_names) for the active version, or None."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT model_blob, feature_names_json FROM model_versions "
            "WHERE agent_id = ? AND is_active = 1",
            (agent_id,),
        ).fetchone()
        if row is None:
            return None
        return bytes(row["model_blob"]), json.loads(row["feature_names_json"])
    finally:
        conn.close()


def list_model_versions(agent_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, agent_id, version, feature_names_json,
                   hyperparams_json, metrics_json, is_active, created_at
            FROM model_versions
            WHERE agent_id = ?
            ORDER BY version DESC
            """,
            (agent_id,),
        ).fetchall()
        result = []
        for r in rows:
            result.append({
                "id":            r["id"],
                "agent_id":      r["agent_id"],
                "version":       r["version"],
                "feature_names": json.loads(r["feature_names_json"]),
                "hyperparams":   json.loads(r["hyperparams_json"]),
                "metrics":       json.loads(r["metrics_json"]) if r["metrics_json"] else None,
                "is_active":     bool(r["is_active"]),
                "created_at":    r["created_at"],
            })
        return result
    finally:
        conn.close()


def rollback_to_version(agent_id: str, version: int) -> bool:
    """Set the specified version as active; deactivate all others. Returns success."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM model_versions WHERE agent_id = ? AND version = ?",
            (agent_id, version),
        ).fetchone()
        if row is None:
            return False
        conn.execute(
            "UPDATE model_versions SET is_active = 0 WHERE agent_id = ?",
            (agent_id,),
        )
        conn.execute(
            "UPDATE model_versions SET is_active = 1 WHERE agent_id = ? AND version = ?",
            (agent_id, version),
        )
        conn.commit()
        return True
    finally:
        conn.close()
