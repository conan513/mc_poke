#!/bin/bash

# ════════════════════════════════════════════════════════════════════════════════
# COBBLEMON UNIVERSE - Client Windows Build Script
# Builds Windows installer (NSIS & Portable) for x64 and arm64
# ════════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Project root is two levels up from this script (mc_poke/)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} COBBLEMON UNIVERSE - Windows Build (NSIS & Portable)"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_header

# Check if running on Windows
if [[ ! "$OSTYPE" =~ ^(msys|cygwin|win32) ]]; then
    print_warning "Ez a script Windows-on működik a legjobban."
    print_info "Ha Linux-on vagy, az AppImage jó alternatíva."
    print_info "Folytatom az NSIS build kísérletét..."
fi

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js nincs telepítve"
    exit 1
fi

print_info "Vite build indítása..."
cd "$PROJECT_ROOT"
npm run build
print_success "Vite build kész"

print_info "Régi release-ek törlése..."
rm -rf web-installer/releases/*
print_success "Release könyvtár kitisztítva"

print_info "Windows build indítása (NSIS & Portable)..."
npm run dist:win

if ls web-installer/releases/*.exe 1> /dev/null 2>&1; then
    print_success "Windows build kész!"
    echo ""
    echo -e "${GREEN}Kész Windows fájlok:${NC}"
    ls -lh web-installer/releases/*.exe web-installer/releases/*.nsis 2>/dev/null || ls -lh web-installer/releases/
else
    print_warning "Nem található Windows build fájl"
fi

exit 0
