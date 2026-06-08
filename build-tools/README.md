# 🎮 Build Tools - COBBLEMON UNIVERSE Client Builder

Szervezett build eszközök a COBBLEMON UNIVERSE Minecraft launcherhez.

## 📁 Struktura

```
build-tools/
├── cli/                          # CLI Build scriptek (terminálból)
│   ├── build-client.sh           # Interaktív menü
│   ├── build-client-linux.sh     # Összes Linux format
│   ├── build-client-linux-arch.sh
│   ├── build-client-linux-debian.sh
│   ├── build-client-linux-redhat.sh
│   ├── build-client-linux-appimage.sh
│   ├── build-client-linux-targz.sh
│   ├── build-client-linux-flatpak.sh
│   ├── build-client-win.sh       # Windows
│   └── build-client-mac.sh       # macOS
│
├── server/                       # Web szerver + Dashboard
│   ├── build-server.js           # Express + WebSocket
│   └── build-client-dashboard.html  # Interaktív UI
│
├── docs/                         # Dokumentáció
│   ├── BUILD_CLIENT.md           # CLI guide
│   ├── BUILD_SERVER.md           # Szerver guide
│   ├── BUILD_SYSTEM.md           # Teljes rendszer
│   └── BUILD_QUICK_REF.sh        # Gyorsreferencia
│
├── start-build-server.sh         # Szerver gyors indítása
└── README.md                     # Ez a fájl
```

---

## 🚀 Gyors Start

### **1. Menüvel (Ajánlott - egyszerű)**
```bash
./start-build-server.sh
```
Válassz az opciók közül interaktívan.

### **2. Közvetlen (Gyors)**
```bash
npm run build-server
```
Majd nyiss meg: `http://localhost:3000`

### **3. Terminálból (CLI)**
```bash
./cli/build-client.sh              # Interaktív menü
./cli/build-client-linux-arch.sh   # Arch Linux csak
./cli/build-client.sh linux-arch   # Direkten argumentummal
```

---

## 🎯 Választható Módszerek

### **A) Web Browser (Legszebb)** ✨
```bash
./start-build-server.sh    # Opció 1
# Megnyílik: http://localhost:3000
# - 🚀 Build gombok
# - Valós idejű output
# - Dark/Light mód
```

### **B) CLI Interactive (Konzol)**
```bash
./cli/build-client.sh
# Menüből válassz
```

### **C) CLI Direct (Script)**
```bash
./cli/build-client-linux-arch.sh    # Arch Linux
./cli/build-client-linux-debian.sh  # Debian/Ubuntu
./cli/build-client-linux-redhat.sh  # Fedora
# stb...
```

### **D) npm (Projekt szintű)**
```bash
npm run build-server          # Web szerver
npm run dist:linux            # Linux összes
npm run dist:linux-arch       # Arch Linux
npm run dist:win              # Windows
npm run dist:mac              # macOS
```

---

## 📚 Dokumentáció

Részletekért olvasd el:

- **[BUILD_SERVER.md](docs/BUILD_SERVER.md)** - Web szerver részletei
- **[BUILD_CLIENT.md](docs/BUILD_CLIENT.md)** - CLI build scriptek
- **[BUILD_SYSTEM.md](docs/BUILD_SYSTEM.md)** - Teljes rendszer overview
- **[BUILD_QUICK_REF.sh](docs/BUILD_QUICK_REF.sh)** - Gyorsreferencia

---

## 🌐 Web Interface

### Indítás
```bash
./start-build-server.sh    # Opció 1
# vagy
npm run build-server
```

### Elérés
```
http://localhost:3000
```

### Funkciók
- ✅ Szép grafikus UI
- ✅ Dark/Light mód
- ✅ 🚀 Build gombok mindegyik platformhoz
- ✅ Valós idejű output megjelenítés
- ✅ Parancsok másolása egy kattintásra
- ✅ WebSocket valós idejű streamelés

---

## ⚙️ API Referencia

### Build indítása
```
POST /api/build/:type

Típusok:
  linux-all, linux-arch, linux-debian, linux-redhat
  linux-appimage, linux-targz, linux-flatpak
  windows, macos
```

### Status
```
GET /api/status
```

---

## 💾 Build Outputs

Összes kimenet ide kerül:
```
../web-installer/releases/
```

Fájlok:
- `*.pacman` - Arch Linux
- `*.deb` - Debian/Ubuntu
- `*.rpm` - Fedora/RHEL
- `*.AppImage` - Universal Linux
- `*.tar.gz` - Portable Linux
- `*.flatpak` - Sandbox Linux
- `*.exe` - Windows
- `*.dmg` - macOS

---

## 🐛 Hibaelhárítás

### "Port 3000 már használatban"
```bash
PORT=8080 npm run build-server
# Nyiss: http://localhost:8080
```

### "Script nem található"
```bash
cd /mnt/raid/Source/mc_poke
./build-tools/start-build-server.sh
```

### WebSocket kapcsolat hiba
1. Frissítsd az oldalt (F5)
2. Nézd meg a böngésző konzolt (F12)
3. Ellenőrizd, hogy a szerver fut-e

---

## 📋 Támogatott Platformok

### Linux Disztribúciók
- ✅ **Arch Linux** - pacman csomag
- ✅ **Debian/Ubuntu** - deb csomag
- ✅ **Fedora/RHEL** - rpm csomag
- ✅ **Universal** - AppImage
- ✅ **Portable** - TAR.GZ
- ✅ **Sandbox** - Flatpak

### Egyéb
- ✅ **Windows** - NSIS installer + Portable
- ✅ **macOS** - DMG installer

---

## 🔧 Fejlesztői Tippek

### Debug mód
```bash
DEBUG=* npm run build-server
```

### Port váltása
```bash
PORT=3001 ./start-build-server.sh
```

### Build output megtekintése
```bash
tail -f ../web-installer/releases/build.log
```

---

## 📞 Support

- Nézd meg a `docs/` mappát részletes dokumentációért
- Ellenőrizd az npm dependenciákat: `npm list`
- Konzol output: szerver indítása után nézd meg az outputot

---

**Üdülj jól buildelmezéssel!** 🎮✨

---

*Utolsó frissítés: 2026. június 8.*
