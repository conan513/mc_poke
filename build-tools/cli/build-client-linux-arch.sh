#!/bin/bash

# ════════════════════════════════════════════════════════════════════════════════
# COBBLEMON UNIVERSE - Client Arch Linux Build Script
# Builds only the pacman package for Arch Linux
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
    echo -e "${BLUE}║${NC} COBBLEMON UNIVERSE - Arch Linux (pacman) Build"
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

print_info "Arch Linux (pacman) build indítása..."
npx electron-builder --linux pacman

if [ -f "web-installer/releases"/*.pacman ]; then
    print_success "Arch Linux build kész!"
    echo ""
    echo -e "${GREEN}Kész pacman csomag:${NC}"
    ls -lh web-installer/releases/*.pacman
else
    print_warning "Nem található pacman csomag"
fi

exit 0
