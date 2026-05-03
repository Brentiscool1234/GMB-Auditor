#!/usr/bin/env bash
set -e

echo ""
echo "============================================"
echo " GMB Auditor — Mac/Linux Installer"
echo "============================================"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js is not installed."
  echo "        Download it from https://nodejs.org then re-run this installer."
  echo ""
  exit 1
fi

NODE_VER=$(node -v)
echo "[OK] Node.js $NODE_VER found"
echo ""

# Install dependencies
echo "Installing dependencies (this may take a minute)..."
echo ""
npm install
echo ""
echo "[OK] Dependencies installed"

# Set up .env
echo ""
if [ -f .env ]; then
  echo "[SKIP] .env file already exists — skipping API key setup."
  echo "       Edit .env manually if you need to change your key."
else
  echo "You need an Anthropic API key to generate reports."
  echo "Get one free at https://console.anthropic.com"
  echo ""
  read -rp " Enter your Anthropic API key: " API_KEY
  echo "ANTHROPIC_API_KEY=$API_KEY" > .env
  echo ""
  echo "[OK] .env file created"
fi

# Make run script executable
chmod +x run.sh 2>/dev/null || true

echo ""
echo "============================================"
echo " Installation complete!"
echo "============================================"
echo ""
echo "To start the app, run:"
echo ""
echo "   ./run.sh"
echo ""
echo "Then open http://localhost:3000 in your browser."
echo ""
