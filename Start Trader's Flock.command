#!/usr/bin/env bash
# ═══════════════════════════════════════════════
#   Trader's Flock — Launcher
#   Double-click this file to start the app.
# ═══════════════════════════════════════════════

# Move into the folder where this file lives
cd "$(dirname "$0")"

FRONTEND_URL="http://localhost:3000"
BACKEND_URL="http://localhost:8000"

# ── Colors ────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ── Header ────────────────────────────────────
echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║       Trader's Flock — Gold Trading      ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check Docker is installed ─────────
if ! command -v docker &>/dev/null; then
    echo -e "${RED}✗  Docker is not installed on this machine.${NC}"
    echo ""
    echo "   Docker is required to run Trader's Flock."
    echo "   Please download and install Docker Desktop:"
    echo ""
    echo "   → https://www.docker.com/products/docker-desktop/"
    echo ""
    echo "   Once installed, open Docker Desktop and run this script again."
    echo ""
    exit 1
fi

# ── Step 2: Check Docker daemon is running ────
if ! docker info &>/dev/null 2>&1; then
    echo -e "${YELLOW}⚙  Docker is installed but not running.${NC}"
    echo "   Attempting to start Docker Desktop…"
    echo ""
    open -a Docker 2>/dev/null || true

    echo -n "   Waiting for Docker to start"
    READY=false
    for i in $(seq 1 30); do
        sleep 2
        if docker info &>/dev/null 2>&1; then
            READY=true
            echo -e " ${GREEN}ready!${NC}"
            break
        fi
        echo -n "."
    done

    if [ "$READY" = false ]; then
        echo ""
        echo -e "${RED}✗  Docker did not start within 60 seconds.${NC}"
        echo ""
        echo "   Please open Docker Desktop manually, wait for it to finish"
        echo "   starting (the whale icon stops animating), then run this script again."
        echo ""
        exit 1
    fi
fi

echo -e "${GREEN}✓  Docker is running${NC}"

# ── Step 3: Create required folders ───────────
mkdir -p backend/db

# ── Step 4: Start services ────────────────────
echo ""
echo -e "${BOLD}Starting Trader's Flock…${NC}"
echo ""
echo "   Building and starting the app. On the very first launch this can"
echo "   take 3–5 minutes. Subsequent starts are much faster."
echo ""

docker compose up --build -d

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}✗  Failed to start the app.${NC}"
    echo ""
    echo "   For details, run:  docker compose logs"
    echo ""
    exit 1
fi

# ── Step 5: Wait for the frontend to respond ──
echo ""
echo -n "   Waiting for the app to be ready"
READY=false
for i in $(seq 1 60); do
    sleep 2
    if curl -sf "$FRONTEND_URL" &>/dev/null; then
        READY=true
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
done

if [ "$READY" = false ]; then
    echo ""
    echo -e "${YELLOW}⚠  The app is taking longer than expected to start.${NC}"
    echo "   It may still be loading data on first run — check it in a moment."
fi

# ── Step 6: Open browser ──────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗"
echo -e "║   ✓  Trader's Flock is running!          ║"
echo -e "╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "   ${BOLD}App:${NC}        $FRONTEND_URL"
echo -e "   ${BOLD}API docs:${NC}   $BACKEND_URL/docs"
echo ""
echo "   Opening your browser…"
open "$FRONTEND_URL"
echo ""
echo -e "   ${BOLD}To stop the app:${NC}  run ./stop.sh"
echo ""
