# Trader'sFlock — Gold Trading Intelligence Platform

A local-first, ML-powered signal platform for gold futures (GC=F). Build, train and compare trading agents across multiple timeframes — no paid APIs, no cloud required. Everything runs on your machine.

**Stack:** Python · FastAPI · SQLite · XGBoost · LightGBM · Optuna · Next.js 14 · WebSocket

---

## Getting Started

### No coding experience? Start here.

**Step 1 — Install Docker Desktop** (one-time, free)

Docker is the only thing you need to install. It packages the entire app so nothing else is required.

→ Download: https://www.docker.com/products/docker-desktop/

Once installed, open Docker Desktop and wait for it to finish starting (the whale icon in your menu bar stops animating).

**Step 2 — Start the app**

Double-click **`Start Trader's Flock.command`** in this folder.

A Terminal window will open and handle everything automatically — building the app, starting it, and opening your browser.
The **first launch takes 3–5 minutes** while it downloads and compiles the app. Every subsequent start takes under 30 seconds.

> **First time only:** macOS may block the file. Right-click it → Open → Open to confirm.

**Step 3 — Stop the app**

Double-click **`Stop Trader's Flock.command`**.

Your data and trained agents are saved between sessions.

---

## Table of Contents

- [Developer Setup](#developer-setup)
- [Environment Variables](#environment-variables)
- [First Run Walkthrough](#first-run-walkthrough)
- [App Pages](#app-pages)
- [Example Strategies](#example-strategies)
- [AI Strategy Assistant](#ai-strategy-assistant)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)

---

## Developer Setup

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | For manual backend setup |
| Node.js | 20+ | For manual frontend setup |
| Docker + Compose | any recent | Easiest option — covers both services |

### Docker (recommended)

One command starts both backend and frontend:

```bash
docker compose up
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| API docs | http://localhost:8000/docs |

On first startup, the backend automatically fetches all historical data from Yahoo Finance. This takes **1–2 minutes** — the Setup Wizard will show progress.

---

## Manual Setup

If you prefer to run without Docker, open **two terminals**.

### Terminal 1 — Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
mkdir -p db
uvicorn app.main:app --reload --port 8000
```

### Terminal 2 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000** once both are running.

---

## Environment Variables

### Frontend (`frontend/.env.local`)

Create this file if it does not exist (copy the example below):

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000
```

These point the frontend to the local backend. No changes needed for a standard local setup.

### Backend

The backend reads from a `.env` file in the `backend/` directory. All settings have defaults and the app works out of the box without any `.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `./db/startgold.db` | Path to the SQLite database |

---

## First Run Walkthrough

A Setup Wizard launches automatically on your first visit to **http://localhost:3000**.

**Step 1 — Data Loading**
Confirm that gold and macro data loaded correctly. You should see bar counts per timeframe (5m, 15m, 30m, 1h, 2h, 4h, 1d).

**Step 2 — Create Your First Agent**
Click **Create and Train Baseline Agent** to spin up a pre-configured XGBoost daily agent. Training runs in the background (~60 seconds). Head to the **Agents** page to watch status change to `trained`.

**Step 3 — Claude Setup (optional)**
Paste your Anthropic API key to enable the AI strategy assistant. This is fully optional — every other feature works without it.

> After setup, the **Quick Start** button on the Agents page creates a new baseline agent at any time.

---

## App Pages

| Route | What it does |
|-------|--------------|
| `/` | Live candlestick chart with signal markers |
| `/agents` | Agent card grid — activate / deactivate agents |
| `/lab` | 4-step builder wizard — pick features, model, hyperparams, then train with Optuna HPO |
| `/portfolio` | Equity curves, trade log, multi-agent performance comparison |
| `/intelligence` | Regime bands, candlestick pattern timeline, parameter heatmap, edge discovery |
| `/simulate` | Monte Carlo fan chart + historical stress scenarios |
| `/assistant` | Claude AI strategy assistant |

---

## Example Strategies

### 1. Daily Momentum with Macro Awareness

Captures multi-day gold trends driven by DXY and real yield movements.

```
Timeframe:       1d
Model:           XGBoost
Features:        return_5, ema_ratio, rsi_14, macd_hist, dxy_return_5,
                 real_yield_proxy, vix_level, volume_ratio
Target horizon:  5 bars
Threshold:       0.3%
Train window:    500 bars
```

### 2. Intraday Volatility Breakout (4h)

Captures expansion from Bollinger squeezes — good for range-breakout entries.

```
Timeframe:       4h
Model:           LightGBM
Features:        bb_squeeze, bb_pct, atr_pct, atr_ratio, volume_ratio,
                 volume_spike, close_position, body_ratio, return_3
Target horizon:  3 bars
Threshold:       0.2%
Train window:    300 bars
```

### 3. Safe-Haven Flow Detector (1d)

Identifies gold surges triggered by risk-off episodes (VIX spikes, equity selloffs).

```
Timeframe:       1d
Model:           Logistic Regression
Features:        vix_level, vix_return_5, spx_return_5, gold_vix_corr_21,
                 gold_dxy_corr_21, tnx_return_5, candle_engulf_bull,
                 candle_morning_star, regime_volatility
Target horizon:  7 bars
Threshold:       0.4%
Train window:    600 bars
```

---

## AI Strategy Assistant

The Assistant lets you design strategies through natural-language conversation with Claude.
Your API key lives in the browser only — it is never sent to the backend.

1. Go to **http://localhost:3000/assistant**
2. Paste your Anthropic API key (get one at https://console.anthropic.com/account/keys)
3. Ask anything, for example:
   - *"Build a mean reversion strategy using Bollinger Bands on 15-minute gold"*
   - *"My Sharpe is 0.35, what should I improve?"*
   - *"Add macro features focused on the DXY/gold relationship"*
4. When Claude produces a strategy config, click **Apply to Builder** to pre-fill the Lab wizard.

---

## Architecture

```
yfinance ──► store.py ──► SQLite (price_data)
                              │
                    feature_store.py (cache)
                              │
                    model_registry.py ──► signals table
                              │
                    WebSocket broadcast ──► frontend
```

**Scheduled jobs (APScheduler)**
- Every 15 min: data refresh + pattern scan + regime detection
- Nightly 02:00: IC monitor — alerts when agent signals degrade

---

## Troubleshooting

**yfinance rate-limited / empty data**
Yahoo Finance occasionally throttles requests. Wait 30 seconds then click **Refresh Data** on the Agents page.
Note: intraday history is capped — 5m/15m/30m → 60 days, 1h/2h/4h → 730 days.

**Training fails with "Insufficient data"**
Reduce `train_window` in the Lab wizard, or switch to a timeframe with more history (`1h` or `1d`).

**Claude API error 401**
Your key may have expired. On the Assistant page, click **Disconnect** and re-enter a fresh key.

**Optuna optimization is slow**
Each trial runs a full walk-forward backtest. Reduce `train_window`, or prefer LightGBM which trains 3–5× faster than XGBoost for similar accuracy.

**Feature `regime_volatility` not available**
Regime features require the `1d` timeframe and at least 63 bars of history. Switch your agent to daily.

---

Built with [Oz (Warp AI)](https://www.warp.dev).
Co-Authored-By: Oz <oz-agent@warp.dev>
