#!/usr/bin/env bash
set -e

echo ""
echo "============================================"
echo " GMB Auditor"
echo "============================================"
echo ""

# Check .env exists
if [ ! -f .env ]; then
  echo "[ERROR] No .env file found."
  echo "        Run ./install.sh first to set up your API key."
  echo ""
  exit 1
fi

echo "Starting app..."
echo "Open http://localhost:3000 in your browser."
echo "Press Ctrl+C to stop."
echo ""

# Open browser after a short delay (best-effort)
(sleep 3 && open "http://localhost:3000" 2>/dev/null || xdg-open "http://localhost:3000" 2>/dev/null || true) &

npm run dev
