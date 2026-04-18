import sqlite3
import os
from app.core.config import settings


def get_db_path() -> str:
    os.makedirs(os.path.dirname(os.path.abspath(settings.database_path)), exist_ok=True)
    return settings.database_path


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(get_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    conn = get_connection()
    try:
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS price_data (
                symbol    TEXT NOT NULL,
                timeframe TEXT NOT NULL,
                ts        INTEGER NOT NULL,
                open      REAL,
                high      REAL,
                low       REAL,
                close     REAL,
                volume    REAL,
                PRIMARY KEY (symbol, timeframe, ts)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                id                TEXT PRIMARY KEY,
                name              TEXT NOT NULL,
                color             TEXT NOT NULL DEFAULT '#d4af37',
                timeframe         TEXT NOT NULL DEFAULT '1d',
                features_json     TEXT NOT NULL DEFAULT '[]',
                model_type        TEXT NOT NULL DEFAULT 'xgboost',
                hyperparams_json  TEXT NOT NULL DEFAULT '{}',
                target_horizon    INTEGER NOT NULL DEFAULT 5,
                target_threshold  REAL NOT NULL DEFAULT 0.3,
                train_window      INTEGER NOT NULL DEFAULT 500,
                position_size_pct REAL NOT NULL DEFAULT 0.1,
                status            TEXT NOT NULL DEFAULT 'created',
                metrics_json      TEXT,
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS agent_models (
                agent_id           TEXT PRIMARY KEY,
                model_blob         BLOB NOT NULL,
                scaler_blob        BLOB,
                feature_names_json TEXT NOT NULL,
                trained_at         INTEGER NOT NULL
            )
        """)

        # ── Model versioning (append-only, max 10 per agent) ──────────────────
        c.execute("""
            CREATE TABLE IF NOT EXISTS model_versions (
                id                 TEXT PRIMARY KEY,
                agent_id           TEXT NOT NULL,
                version            INTEGER NOT NULL,
                model_blob         BLOB NOT NULL,
                feature_names_json TEXT NOT NULL,
                hyperparams_json   TEXT NOT NULL DEFAULT '{}',
                metrics_json       TEXT,
                is_active          INTEGER NOT NULL DEFAULT 0,
                created_at         INTEGER NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id),
                UNIQUE (agent_id, version)
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_mv_agent_active ON model_versions(agent_id, is_active)")

        # ── Candlestick / price-action patterns ───────────────────────────────
        c.execute("""
            CREATE TABLE IF NOT EXISTS patterns (
                id           TEXT PRIMARY KEY,
                symbol       TEXT NOT NULL,
                timeframe    TEXT NOT NULL,
                ts           INTEGER NOT NULL,
                pattern_type TEXT NOT NULL,
                direction    TEXT NOT NULL,
                strength     REAL NOT NULL,
                confirmed_at INTEGER
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_patterns_sym_tf_ts ON patterns(symbol, timeframe, ts)")

        c.execute("""
            CREATE TABLE IF NOT EXISTS pattern_stats (
                pattern_type TEXT NOT NULL,
                timeframe    TEXT NOT NULL,
                direction    TEXT NOT NULL,
                n_total      INTEGER NOT NULL DEFAULT 0,
                n_correct    INTEGER NOT NULL DEFAULT 0,
                mean_fwd_ret REAL,
                updated_at   INTEGER NOT NULL,
                PRIMARY KEY (pattern_type, timeframe, direction)
            )
        """)

        # ── Market regimes (daily, from KMeans on 21d ATR) ────────────────────
        c.execute("""
            CREATE TABLE IF NOT EXISTS market_regimes (
                ts     INTEGER PRIMARY KEY,
                regime TEXT NOT NULL,
                atr_21 REAL NOT NULL
            )
        """)

        # ── Feature Store cache ───────────────────────────────────────────────
        c.execute("""
            CREATE TABLE IF NOT EXISTS feature_cache (
                agent_id    TEXT NOT NULL,
                hash_key    TEXT NOT NULL,
                features_blob BLOB NOT NULL,
                index_blob    BLOB NOT NULL,
                computed_at INTEGER NOT NULL,
                PRIMARY KEY (agent_id, hash_key)
            )
        """)

        # ── Performance / IC monitoring ───────────────────────────────────────
        c.execute("""
            CREATE TABLE IF NOT EXISTS performance_log (
                id        TEXT PRIMARY KEY,
                agent_id  TEXT NOT NULL,
                ts        INTEGER NOT NULL,
                ic_7d     REAL,
                ic_21d    REAL,
                sharpe_7d REAL,
                n_signals INTEGER,
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_perf_agent_ts ON performance_log(agent_id, ts)")

        # ── Notifications ─────────────────────────────────────────────────────
        c.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id         TEXT PRIMARY KEY,
                agent_id   TEXT,
                type       TEXT NOT NULL,
                message    TEXT NOT NULL,
                is_read    INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
        """)
        c.execute("CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(is_read, created_at)")

        c.execute("""
            CREATE TABLE IF NOT EXISTS portfolios (
                id                   TEXT PRIMARY KEY,
                agent_id             TEXT NOT NULL,
                initial_capital      REAL NOT NULL DEFAULT 10000,
                current_capital      REAL NOT NULL DEFAULT 10000,
                position             REAL NOT NULL DEFAULT 0,
                position_entry_price REAL,
                position_size_pct    REAL NOT NULL DEFAULT 0.1,
                created_at           INTEGER NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id           TEXT PRIMARY KEY,
                portfolio_id TEXT NOT NULL,
                agent_id     TEXT NOT NULL,
                signal       TEXT NOT NULL,
                entry_price  REAL NOT NULL,
                exit_price   REAL,
                quantity     REAL NOT NULL,
                pnl          REAL,
                opened_at    INTEGER NOT NULL,
                closed_at    INTEGER,
                status       TEXT NOT NULL DEFAULT 'open',
                FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS signals (
                id        TEXT PRIMARY KEY,
                agent_id  TEXT NOT NULL,
                ts        INTEGER NOT NULL,
                timeframe TEXT NOT NULL,
                signal    TEXT NOT NULL,
                confidence REAL NOT NULL,
                FOREIGN KEY (agent_id) REFERENCES agents(id)
            )
        """)

        c.execute("CREATE INDEX IF NOT EXISTS idx_price_symbol_tf_ts ON price_data(symbol, timeframe, ts)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_signals_agent_ts ON signals(agent_id, ts)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_trades_agent ON trades(agent_id, opened_at)")

        conn.commit()
    finally:
        conn.close()
