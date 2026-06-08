#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d node_modules ]; then
  echo "node_modules könyvtár nem található. Telepítés indul..."
  npm install
fi

get_total_mem_mb() {
  awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo
}

derive_default_heap() {
  local total_mb="$1"
  if [ "$total_mb" -lt 6144 ]; then
    echo "3G"
  elif [ "$total_mb" -lt 8192 ]; then
    echo "4G"
  else
    echo "5G"
  fi
}

derive_default_min_heap() {
  local max_heap="$1"
  if [[ "$max_heap" =~ ^([0-9]+)G$ ]]; then
    local max_val="${BASH_REMATCH[1]}"
    if [ "$max_val" -le 2 ]; then
      echo "1G"
    else
      echo "$((max_val / 2))G"
    fi
  else
    echo "2G"
  fi
}

if [ -n "${PORT:-}" ]; then
  echo "PORT=$PORT használata"
fi

if [ -z "${COBBLE_SERVER_MAX_HEAP:-}" ]; then
  total_mem_mb="$(get_total_mem_mb)"
  echo "Rendszer memóriája: ${total_mem_mb} MB"
  COBBLE_SERVER_MAX_HEAP="$(derive_default_heap "$total_mem_mb")"
fi

if [ -z "${COBBLE_SERVER_MIN_HEAP:-}" ]; then
  COBBLE_SERVER_MIN_HEAP="$(derive_default_min_heap "$COBBLE_SERVER_MAX_HEAP")"
fi

export COBBLE_SERVER_MAX_HEAP
export COBBLE_SERVER_MIN_HEAP

echo "Cobble server indítása gépre optimalizált low-memory módban..."
echo "Heap: Xms=$COBBLE_SERVER_MIN_HEAP, Xmx=$COBBLE_SERVER_MAX_HEAP"
npm run start
