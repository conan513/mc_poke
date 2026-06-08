#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

CONF_FILE="/etc/sysctl.d/99-cobble-server.conf"
BACKUP_FILE="${CONF_FILE}.bak"

print_usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Linux system tuning for Cobble server performance.
This script applies safe CPU and memory sysctl settings,
optionally persists them, and can enable the performance governor.

Options:
  --dry-run                 Print the settings without applying them.
  --apply                   Apply settings immediately.
  --persist                 Save settings to ${CONF_FILE} for reboot persistence.
  --enable-cpu-performance  Set CPU scaling governor to performance on all CPUs.
  --disable-swap           Disable swap immediately and optionally persist disable.
  --restore                 Restore previous sysctl configuration and remove persistent tuning.
  --help                    Show this help message.
EOF
}

ensure_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    echo "Ez a script csak Linux rendszeren fut."
    exit 1
  fi
}

need_root() {
  if [[ $(id -u) -ne 0 ]]; then
    echo "Root jogosultság szükséges. Futtasd sudo-val."
    exit 1
  fi
}

print_change() {
  local key="$1"
  local value="$2"
  printf "%s = %s\n" "$key" "$value"
}

apply_sysctl_entry() {
  local key="$1"
  local value="$2"
  if sysctl -w "${key}=${value}" >/dev/null 2>&1; then
    printf "Applied: %s=%s\n" "$key" "$value"
  else
    printf "Failed to apply: %s=%s\n" "$key" "$value"
  fi
}

set_governor_performance() {
  local cpu_dir
  local governor_file
  local success=false

  for cpu_dir in /sys/devices/system/cpu/cpu[0-9]*; do
    governor_file="$cpu_dir/cpufreq/scaling_governor"
    if [[ -w "$governor_file" ]]; then
      echo performance > "$governor_file"
      printf "CPU governor set to performance: %s\n" "$cpu_dir"
      success=true
    fi
  done

  if [[ "$success" != true ]]; then
    echo "Nem találtam írható scaling_governor fájlt. Ellenőrizd, hogy a cpufreq modul betöltődött-e."
    exit 1
  fi
}

disable_swap_now() {
  if swapoff -a; then
    echo "Swap leállítva."
  else
    echo "Swap leállítása sikertelen."
    exit 1
  fi
}

persist_sysctl() {
  need_root
  echo "Mentés: ${CONF_FILE}"
  if [[ -f "$CONF_FILE" && ! -f "$BACKUP_FILE" ]]; then
    cp "$CONF_FILE" "$BACKUP_FILE"
    echo "Eredeti fájl mentése: ${BACKUP_FILE}"
  fi
  cat > "$CONF_FILE" <<EOF
# Cobble server tuning
vm.swappiness = 10
vm.vfs_cache_pressure = 50
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.overcommit_memory = 1
vm.overcommit_ratio = 50
vm.max_map_count = 262144
fs.file-max = 1000000
net.core.somaxconn = 1024
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
kernel.pid_max = 4194304
vm.stat_interval = 10
EOF
  sysctl --system >/dev/null 2>&1 || true
  echo "Persistens beállítások létrehozva és betöltve."
}

restore_persistence() {
  need_root
  if [[ -f "$BACKUP_FILE" ]]; then
    mv "$BACKUP_FILE" "$CONF_FILE"
    sysctl --system >/dev/null 2>&1 || true
    echo "Visszaállítva korábbi sysctl beállítások: ${BACKUP_FILE} -> ${CONF_FILE}."
  elif [[ -f "$CONF_FILE" ]]; then
    rm -f "$CONF_FILE"
    sysctl --system >/dev/null 2>&1 || true
    echo "Eltávolítottam az ${CONF_FILE} beállításokat."
  else
    echo "Nincs visszaállítandó konfiguráció."
  fi
}

if [[ $# -eq 0 ]]; then
  print_usage
  exit 0
fi

DRY_RUN=false
APPLY=false
PERSIST=false
CPU_PERF=false
DISABLE_SWAP=false
RESTORE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --apply)
      APPLY=true
      shift
      ;;
    --persist)
      PERSIST=true
      shift
      ;;
    --enable-cpu-performance)
      CPU_PERF=true
      shift
      ;;
    --disable-swap)
      DISABLE_SWAP=true
      shift
      ;;
    --restore)
      RESTORE=true
      shift
      ;;
    --help|-h)
      print_usage
      exit 0
      ;;
    *)
      echo "Ismeretlen opció: $1"
      print_usage
      exit 1
      ;;
  esac
done

ensure_linux

SYSCTL_ENTRIES=(
  "vm.swappiness=10"
  "vm.vfs_cache_pressure=50"
  "vm.dirty_ratio=15"
  "vm.dirty_background_ratio=5"
  "vm.overcommit_memory=1"
  "vm.overcommit_ratio=50"
  "vm.max_map_count=262144"
  "fs.file-max=1000000"
  "net.core.somaxconn=1024"
  "net.ipv4.tcp_tw_reuse=1"
  "net.ipv4.tcp_fin_timeout=15"
  "kernel.pid_max=4194304"
  "vm.stat_interval=10"
)

if [[ "$RESTORE" == true ]]; then
  restore_persistence
  exit 0
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run: ezek a beállítások kerülnének alkalmazásra:\n"
  for entry in "${SYSCTL_ENTRIES[@]}"; do
    print_change "${entry%%=*}" "${entry#*=}"
  done
  if [[ "$CPU_PERF" == true ]]; then
    echo "CPU governor: performance" 
  fi
  if [[ "$DISABLE_SWAP" == true ]]; then
    echo "Swap letiltása: igen" 
  fi
  exit 0
fi

if [[ "$APPLY" == false && "$PERSIST" == false && "$CPU_PERF" == false && "$DISABLE_SWAP" == false ]]; then
  echo "Nincs megadott művelet. Használd --apply, --persist, --enable-cpu-performance vagy --disable-swap."
  print_usage
  exit 1
fi

need_root

if [[ "$APPLY" == true ]]; then
  echo "Alkalmazás: CPU és memória sysctl beállítások..."
  for entry in "${SYSCTL_ENTRIES[@]}"; do
    apply_sysctl_entry "${entry%%=*}" "${entry#*=}"
  done
  if [[ -w /proc/sys/vm/compact_memory ]]; then
    echo 1 > /proc/sys/vm/compact_memory || true
    echo "Memória tömörítés indítása (compact_memory)."
  fi
fi

if [[ "$CPU_PERF" == true ]]; then
  echo "CPU scaling governor teljesítményre állítása..."
  set_governor_performance
fi

if [[ "$DISABLE_SWAP" == true ]]; then
  echo "Swap letiltása..."
  disable_swap_now
fi

if [[ "$PERSIST" == true ]]; then
  persist_sysctl
fi

echo "Rendszer optimalizálás kész."
