# 🌌 Cobblemon Universe Ecosystem

Welcome to **Cobblemon Universe**, the most complete and modern Pokémon experience in Minecraft. This project provides a comprehensive, automated ecosystem including a custom high-performance launcher, a premium web installer, and a dedicated server management hub.

![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=for-the-badge)
![Arch](https://img.shields.io/badge/Architecture-x64%20%7C%20ARM64-red?style=for-the-badge)
![Languages](https://img.shields.io/badge/Languages-14+-orange?style=for-the-badge)

---

## 📂 Project Structure

The repository is built on three main pillars:

1.  **🚀 Cobblemon Universe Launcher (Client)**: A premium, Electron-based Minecraft client that automates the entire gaming experience with built-in mod syncing and 3D skin management.
2.  **🌐 Web-Installer (Landing Page)**: A modern, responsive website with automatic OS detection, download assistance, and live server statistics.
3.  **🛠️ Universe Server Control (Host)**: A Node.js-based central server that manages game instances, mod synchronization via Modrinth, and the Skin API.

---

## 🚀 1. Cobblemon Universe Launcher

A custom-designed, visually stunning launcher that takes the technical burden off the players' shoulders.

### Key Features:
*   🌍 **Internationalization (i18n):** 14+ supported languages with automatic system language detection.
*   🔄 **Intelligent Mod Sync:** The client checks the server status at every launch and automatically syncs mods, configs, and assets.
*   👤 **Premium Skin System:** Built-in 3D skin viewer and uploader interface, synchronizing player appearance directly with the server.
*   ⚙️ **Auto-Setup:** Automatically manages the correct Java 21 environment and Fabric Loader installation.
*   🛡️ **Cobble Protocol:** Seamless deep-linking support (`cobble://`) for joining servers or applying skins directly from the web.
*   ✨ **Auto-Updater:** Native cross-platform auto-update system to ensure players are always on the latest version.
*   🎨 **Cinematic UI:** Glassmorphism interfaces, dynamic background animations, and smooth transitions.

---

## 🌐 2. Web-Installer (Landing Page)

The first point of contact for players, located in the `web-installer` folder.

*   💻 **Smart OS Detection:** Automatically offers the appropriate installer for Windows, Linux, or macOS.
*   📦 **Multi-Architecture Support:** Ready for both **x64** and **ARM64** (Apple Silicon & Linux ARM).
*   📊 **Real-time Stats:** Displays live server status, player counts, and modpack versioning.
*   🎨 **Premium Aesthetic:** Modern, responsive design with high-quality assets and intuitive navigation.

---

## 🛠️ 3. Universe Server Control

The central brain of the ecosystem, located in the `/cobble-server` folder.

*   🖥️ **Web Dashboard:** Full remote control (Start/Stop, Console access, RAM management).
*   🔍 **Modrinth v2 Integration:** Automated mod discovery, installation, and dependency resolution.
*   📋 **Manifest Engine:** Serves dynamic manifests to clients for perfect synchronization.
*   👕 **Skin API:** Securely manages and serves player skins to the `SkinsRestorer` mod.

---

## 🛠️ Technology Stack

*   **Frontend:** Vanilla JS, HTML5, CSS3 (Advanced design tokens).
*   **Launcher Core:** [Electron 41](https://www.electronjs.org/) & [Vite](https://vitejs.dev/).
*   **Backend:** Node.js (High-concurrency raw HTTP server).
*   **Game Engine:** Minecraft 1.21.1 (Fabric Loader).
*   **APIs:** Modrinth API v2, Cobblemon Official Metadata.

---

## 🏁 Development & Build

### Development Environment:
```bash
# Install dependencies
npm install

# Run launcher in development mode
npm run dev

# Run web installer separately
npm run serve:web
```

### Production Build (Distribution):
```bash
# Build for current OS
npm run dist

# Specific platform builds
npm run dist:win      # Windows (NSIS & Portable)
npm run dist:linux    # Linux (AppImage, DEB, RPM, Pacman)
npm run dist:mac      # macOS (DMG & ZIP, x64 & ARM64)
npm run dist:flatpak  # Linux Flatpak
```

### Server Setup:
```bash
cd cobble-server
npm install
node server.js
```

---

## 📝 License & Copyright

Copyright © 2026 **LUMYVERSE & Conan** (Cobblemon Universe Team). All rights reserved.

This project is designed to enhance the community Pokémon experience. While the ecosystem supports various authentication modes, we recommend using a licensed Minecraft account to support the developers and access all features.

---
*Powered by Cobblemon Universe* 🌌
