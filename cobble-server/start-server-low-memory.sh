#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "node_modules könyvtár nem található. Telepítés indul..."
  npm install
fi

# Alacsony memória beállítások
export COBBLE_SERVER_MAX_HEAP="${COBBLE_SERVER_MAX_HEAP:-4G}"
export COBBLE_SERVER_MIN_HEAP="${COBBLE_SERVER_MIN_HEAP:-2G}"

if [ -n "${PORT:-}" ]; then
  echo "PORT=$PORT használata"
fi

echo "Cobble server indítása alacsony memória módon..."
echo "Heap: Xms=$COBBLE_SERVER_MIN_HEAP, Xmx=$COBBLE_SERVER_MAX_HEAP"
npm run start
