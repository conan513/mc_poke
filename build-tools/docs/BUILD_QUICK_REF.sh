#!/bin/bash
# COBBLEMON UNIVERSE - Build Scripts Quick Reference
# Gyorsreferencia a client buildek indításához

# ════════════════════════════════════════════════════════════════════════════════
# ARCH LINUX BUILD (Ajánlott Arch felhasználóknak)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux-arch.sh
# Eredmény: Cobblemon-Universe-x64.pacman
# Telepítés: sudo pacman -U web-installer/releases/Cobblemon-Universe-x64.pacman

# ════════════════════════════════════════════════════════════════════════════════
# DEBIAN/UBUNTU BUILD
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux-debian.sh
# Eredmény: Cobblemon-Universe-x64.deb
# Telepítés: sudo apt install ./web-installer/releases/Cobblemon-Universe-x64.deb

# ════════════════════════════════════════════════════════════════════════════════
# RED HAT/FEDORA BUILD
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux-redhat.sh
# Eredmény: Cobblemon-Universe-x64.rpm
# Telepítés: sudo dnf install web-installer/releases/Cobblemon-Universe-x64.rpm

# ════════════════════════════════════════════════════════════════════════════════
# APPIMAGE BUILD (Universal Linux)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux-appimage.sh
# Eredmény: Cobblemon-Universe-x64.AppImage, Cobblemon-Universe-arm64.AppImage
# Futtatás: chmod +x web-installer/releases/Cobblemon-Universe-x64.AppImage
#           ./web-installer/releases/Cobblemon-Universe-x64.AppImage

# ════════════════════════════════════════════════════════════════════════════════
# FLATPAK BUILD
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux-flatpak.sh
# Eredmény: Cobblemon-Universe.flatpak
# Telepítés: flatpak install web-installer/releases/Cobblemon-Universe.flatpak

# ════════════════════════════════════════════════════════════════════════════════
# TAR.GZ BUILD (Portable)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux-targz.sh
# Eredmény: Cobblemon-Universe-x64.tar.gz, Cobblemon-Universe-arm64.tar.gz
# Telepítés: tar -xzf web-installer/releases/Cobblemon-Universe-x64.tar.gz

# ════════════════════════════════════════════════════════════════════════════════
# ÖSSZES LINUX FORMAT
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-linux.sh
# Eredmény: .pacman, .deb, .rpm, .AppImage, .tar.gz, .flatpak formátumok

# ════════════════════════════════════════════════════════════════════════════════
# WINDOWS BUILD (Windows-on)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-win.sh
# Eredmény: .exe installerek és portable verzió

# ════════════════════════════════════════════════════════════════════════════════
# MACOS BUILD (macOS-en)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client-mac.sh
# Eredmény: Cobblemon-Universe-x64.dmg

# ════════════════════════════════════════════════════════════════════════════════
# INTERAKTÍV PLATFORMVÁLASZTÓ (Ajánlott)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client.sh
# Interaktív menü jelenik meg - válaszd ki a platformot

# ════════════════════════════════════════════════════════════════════════════════
# PARANCSSORI ARGUMENTUMOK (build-client.sh-hez)
# ════════════════════════════════════════════════════════════════════════════════
# ./build-client.sh linux-all      - Összes Linux formátum
# ./build-client.sh linux-arch     - Arch Linux
# ./build-client.sh linux-debian   - Debian/Ubuntu
# ./build-client.sh linux-redhat   - Red Hat/Fedora
# ./build-client.sh linux-appimage - AppImage
# ./build-client.sh linux-targz    - TAR.GZ
# ./build-client.sh linux-flatpak  - Flatpak
# ./build-client.sh windows        - Windows
# ./build-client.sh macos          - macOS
# ./build-client.sh all            - Összes platform (ha támogatva van)

echo "Üdülj jól buildelmezéssel! 🎮"
