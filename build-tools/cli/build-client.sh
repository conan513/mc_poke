#!/bin/bash

# ════════════════════════════════════════════════════════════════════════════════
# COBBLEMON UNIVERSE - Client Build Script (Cross-Platform)
# ════════════════════════════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Project root is two levels up from this script (mc_poke/)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ════════════════════════════════════════════════════════════════════════════════
# Functions
# ════════════════════════════════════════════════════════════════════════════════

print_header() {
    echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} $1"
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

show_menu() {
    echo ""
    echo -e "${YELLOW}Válassz platformot:${NC}"
    echo "  1) Linux - Összes formátum (AppImage, deb, rpm, pacman, tar.gz)"
    echo "  2) Linux - Arch Linux (pacman)"
    echo "  3) Linux - Debian/Ubuntu (deb)"
    echo "  4) Linux - Red Hat/Fedora (rpm)"
    echo "  5) Linux - AppImage (x64 & arm64)"
    echo "  6) Linux - TAR.GZ (x64 & arm64)"
    echo "  7) Linux - Flatpak"
    echo "  8) Windows - Összes formátum (NSIS installer & Portable)"
    echo "  9) macOS - DMG"
    echo " 10) Összes platform"
    echo " 11) Kilépés"
    echo ""
}

check_dependencies() {
    local missing=0
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js nincs telepítve"
        missing=1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm nincs telepítve"
        missing=1
    fi
    
    if [ $missing -eq 1 ]; then
        return 1
    fi
    return 0
}

build_vite() {
    print_info "Vite build indítása..."
    cd "$PROJECT_ROOT"
    npm run build
    print_success "Vite build kész"
}

clean_releases() {
    print_info "Régi release-ek törlése..."
    rm -rf "$PROJECT_ROOT/web-installer/releases"/*
    print_success "Release könyvtár kitisztítva"
}

# ════════════════════════════════════════════════════════════════════════════════
# Linux Build Functions
# ════════════════════════════════════════════════════════════════════════════════

build_linux_all() {
    print_header "Linux - Összes formátum"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux"
    npm run dist:linux
    print_success "Linux buildek kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"
}

build_linux_arch() {
    print_header "Linux - Arch Linux (pacman)"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux pacman"
    npx electron-builder --linux pacman
    print_success "Arch Linux build kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"/*.pacman 2>/dev/null || print_warning "Nincs pacman csomagfájl"
}

build_linux_debian() {
    print_header "Linux - Debian/Ubuntu (deb)"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux deb"
    npx electron-builder --linux deb
    print_success "Debian/Ubuntu build kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"/*.deb 2>/dev/null || print_warning "Nincs deb csomagfájl"
}

build_linux_redhat() {
    print_header "Linux - Red Hat/Fedora (rpm)"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux rpm"
    npx electron-builder --linux rpm
    print_success "Red Hat/Fedora build kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"/*.rpm 2>/dev/null || print_warning "Nincs rpm csomagfájl"
}

build_linux_appimage() {
    print_header "Linux - AppImage (x64 & arm64)"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux AppImage"
    npx electron-builder --linux AppImage
    print_success "AppImage buildek kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"/*.AppImage 2>/dev/null || print_warning "Nincs AppImage fájl"
}

build_linux_targz() {
    print_header "Linux - TAR.GZ (x64 & arm64)"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux tar.gz"
    npx electron-builder --linux tar.gz
    print_success "TAR.GZ buildek kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"/*.tar.gz 2>/dev/null || print_warning "Nincs tar.gz fájl"
}

build_linux_flatpak() {
    print_header "Linux - Flatpak"
    build_vite
    clean_releases
    print_info "electron-builder indítása: --linux flatpak"
    npm run dist:flatpak
    print_success "Flatpak build kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"/*.flatpak 2>/dev/null || print_warning "Nincs flatpak fájl"
}

# ════════════════════════════════════════════════════════════════════════════════
# Windows Build Functions
# ════════════════════════════════════════════════════════════════════════════════

build_windows() {
    print_header "Windows - Összes formátum"
    
    if [[ "$OSTYPE" != "msys" && "$OSTYPE" != "cygwin" && "$OSTYPE" != "win32" ]]; then
        print_warning "Jelenleg nem Windows rendszeren vagy. Az NSIS builder csak Windows-on működik."
        print_info "Az AppImage helyettes alternatíva Linux-on."
        return 1
    fi
    
    build_vite
    clean_releases
    print_info "electron-builder indítása: --win"
    npm run dist:win
    print_success "Windows buildek kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"
}

# ════════════════════════════════════════════════════════════════════════════════
# macOS Build Functions
# ════════════════════════════════════════════════════════════════════════════════

build_macos() {
    print_header "macOS - DMG"
    
    if [[ "$OSTYPE" != "darwin"* ]]; then
        print_warning "Jelenleg nem macOS-en vagy. A macOS build csak macOS-en működik."
        return 1
    fi
    
    build_vite
    clean_releases
    print_info "electron-builder indítása: --mac"
    npm run dist:mac
    print_success "macOS build kész!"
    ls -lh "$PROJECT_ROOT/web-installer/releases"
}

# ════════════════════════════════════════════════════════════════════════════════
# Main Logic
# ════════════════════════════════════════════════════════════════════════════════

main() {
    print_header "COBBLEMON UNIVERSE - Client Builder"
    
    # Check dependencies
    if ! check_dependencies; then
        print_error "Szükséges függőségek hiányoznak. Telepítsd őket és próbáld újra."
        exit 1
    fi
    
    # If argument provided, use it directly
    if [ $# -gt 0 ]; then
        case "$1" in
            linux-all) build_linux_all ;;
            linux-arch) build_linux_arch ;;
            linux-debian) build_linux_debian ;;
            linux-redhat) build_linux_redhat ;;
            linux-appimage) build_linux_appimage ;;
            linux-targz) build_linux_targz ;;
            linux-flatpak) build_linux_flatpak ;;
            windows) build_windows ;;
            macos) build_macos ;;
            all)
                build_linux_all
                build_windows 2>/dev/null || print_warning "Windows build kihagyva (nem Windows rendszer)"
                build_macos 2>/dev/null || print_warning "macOS build kihagyva (nem macOS rendszer)"
                ;;
            *)
                print_error "Ismeretlen argumentum: $1"
                echo "Elérhetők: linux-all, linux-arch, linux-debian, linux-redhat, linux-appimage, linux-targz, linux-flatpak, windows, macos, all"
                exit 1
                ;;
        esac
    else
        # Interactive menu
        while true; do
            show_menu
            read -p "Választás: " choice
            
            case $choice in
                1) build_linux_all ;;
                2) build_linux_arch ;;
                3) build_linux_debian ;;
                4) build_linux_redhat ;;
                5) build_linux_appimage ;;
                6) build_linux_targz ;;
                7) build_linux_flatpak ;;
                8) build_windows ;;
                9) build_macos ;;
                10)
                    build_linux_all
                    build_windows 2>/dev/null || print_warning "Windows build kihagyva (nem Windows rendszer)"
                    build_macos 2>/dev/null || print_warning "macOS build kihagyva (nem macOS rendszer)"
                    ;;
                11)
                    print_info "Kilépés"
                    exit 0
                    ;;
                *)
                    print_error "Érvénytelen választás"
                    ;;
            esac
            
            read -p "Vissza a menübe? (Enter)"
        done
    fi
}

# Run main function
main "$@"
