#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "node_modules könyvtár nem található. Telepítés indul..."
  npm install
fi

if [ -n "${PORT:-}" ]; then
  echo "PORT=$PORT használata"
fi

echo "Cobble server indítása..."
npm run start
