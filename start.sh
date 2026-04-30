#!/bin/bash
cd "$(dirname "$0")"
echo "========================================="
echo "   TTMRank - TapTap Rankings Aggregator"
echo "========================================="
echo ""

if [ -f "app/start.py" ]; then
    python3 app/start.py
else
    echo "[1/2] Fetching latest data..."
    python3 app/fetcher.py
    if [ $? -ne 0 ]; then
        echo "Failed to fetch data. Please ensure Python 3 is installed."
        read -p "Press Enter to exit..."
        exit 1
    fi
    echo ""
    echo "[2/2] Starting server..."
    python3 app/server.py
fi
