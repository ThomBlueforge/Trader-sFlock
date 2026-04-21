#!/usr/bin/env bash
# ═══════════════════════════════════════════════
#   Trader's Flock — Stop
#   Run this script to shut the app down.
# ═══════════════════════════════════════════════

GREEN='\033[0;32m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}Stopping Trader's Flock…${NC}"
echo ""

docker compose down

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓  All services stopped.${NC}"
    echo ""
    echo "   Your data is saved. Run ./start.sh anytime to restart."
    echo ""
else
    echo ""
    echo -e "${RED}✗  Something went wrong while stopping.${NC}"
    echo "   Try running:  docker compose down --remove-orphans"
    echo ""
fi
