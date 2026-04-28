# 🌌 Cobblemon Universe Ecosystem

Welcome to **Cobblemon Universe**, the most complete and modern Pokémon experience in Minecraft. This project provides a comprehensive, automated ecosystem including a custom launcher, web installer, and dedicated server management hub.

![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=for-the-badge)
![Languages](https://img.shields.io/badge/Languages-14+-orange?style=for-the-badge)

---

## 📂 Project Structure

The repository is built on three main pillars:

1.  **🚀 Cobblemon Universe Launcher (Client)**: A premium, Electron-based Minecraft client that automates the entire gaming experience.
2.  **🌐 Web-Installer (Landing Page)**: A modern, responsive website with automatic OS detection and download assistance.
3.  **🛠️ Universe Server Control (Host)**: A Node.js-based central server that manages the game and mod synchronization.

---

## 🚀 1. Cobblemon Universe Launcher

A custom-designed, visually stunning launcher that takes the technical burden off the players' shoulders.

### Key Features:
*   🌍 **Internationalization (i18n):** 14+ supported languages with automatic system language detection (Windows, Linux, macOS).
*   🔄 **Intelligent Mod Sync:** The client checks the server status at every launch and automatically syncs necessary mods and configurations.
*   👤 **Skin System:** Built-in 3D skin viewer and uploader interface, synchronizing player appearance with the server.
*   ⚙️ **Auto-Setup:** Automatically installs the correct Java 21 environment and Fabric Loader.
*   🎨 **Premium Design:** Cinematic background images, glassmorphism interfaces, and smooth animations.

---

## 🌐 2. Web-Installer (Landing Page)

The first point of contact for players, a modern landing page located in the `web-installer` folder.

*   💻 **OS Detection:** Automatically offers the appropriate installer for your system (Windows, Linux, or Mac).
*   📦 **Cross-Platform Support:** Available in EXE, AppImage, DEB, RPM, DMG, and ZIP formats.
*   📊 **Live Server Status:** Displays current server status, installed mod count, and the next scheduled restart.

---

## 🛠️ 3. Universe Server Control

The central brain of the ecosystem, located in the `/cobble-server` folder.

*   🖥️ **Web Dashboard:** Full control from the browser (Start/Stop, RAM management).
*   🔍 **Modrinth Integration:** Built-in mod search and installer with version control and update checking.
*   📋 **Manifest API:** Serves clients with the exact mod list and configurations.
*   👕 **Skin API:** Manages player skins and serves them to the SkinsRestorer mod.

---

## 🛠️ Technology Stack

*   **Frontend:** Vanilla JS, HTML5, CSS3 (Modern design tokens).
*   **Backend:** Node.js (Raw HTTP server for maximum speed).
*   **Frameworks:** Electron 31 (Launcher), Vite (Build tool).
*   **APIs:** Modrinth API v2, Cobblemon Official Metadata.

---

## 🏁 Quick Start

### Client (Development):
```bash
npm install
npm run dev
```

### Server Start:
```bash
cd cobble-server
npm install
node server.js
```

### Web-Installer:
The server automatically hosts the `web-installer` content at `http://localhost:8080`.

---

## 📝 License & Notes
This project aims to maximize the community gaming experience. The client and server can operate in offline (cracked) mode, but we recommend using original Minecraft to fully enjoy the Pokémon experience.

© 2026 Cobblemon Universe Team
