# 🎮 COBBLEMON UNIVERSE - Client Build System

Teljes build rendszer a COBBLEMON UNIVERSE Minecraft launcher-höz platform-specifikus buildekkel, grafikus interfésszel és WebSocket valós idejű outputtal.

## 🏗️ Rendszer Architektúra

```
┌─────────────────────────────────────────────────────────┐
│                   Web Dashboard (HTML)                   │
│         (build-client-dashboard.html)                   │
│  - Grafikus interfész                                   │
│  - Szép UI/UX Dark/Light mód-dal                       │
│  - Másolható parancsok                                  │
└─────────────────┬───────────────────────────────────────┘
                  │
                  │ REST API + WebSocket
                  │
┌─────────────────▼───────────────────────────────────────┐
│               Node.js Express Server                     │
│              (build-server.js)                           │
│  - HTTP endpoint-ok                                     │
│  - WebSocket valós idejű stream                        │
│  - Shell script futtatás (child_process)               │
└─────────────────┬───────────────────────────────────────┘
                  │
                  │ spawn()
                  │
┌─────────────────▼───────────────────────────────────────┐
│              Build Scripts (bash)                        │
│                                                         │
│  Linux:                                                │
│  - build-client-linux.sh (összes)                      │
│  - build-client-linux-arch.sh (Arch)                  │
│  - build-client-linux-debian.sh (Debian)              │
│  - build-client-linux-redhat.sh (Fedora)              │
│  - build-client-linux-appimage.sh (AppImage)          │
│  - build-client-linux-targz.sh (TAR.GZ)               │
│  - build-client-linux-flatpak.sh (Flatpak)           │
│                                                         │
│  Windows:                                              │
│  - build-client-win.sh (NSIS & Portable)              │
│                                                         │
│  macOS:                                                │
│  - build-client-mac.sh (DMG)                          │
└─────────────────┬───────────────────────────────────────┘
                  │
                  │ npm run build + electron-builder
                  │
                  ▼
┌─────────────────────────────────────────────────────────┐
│            Platform-Specifikus Buildek                   │
│        (web-installer/releases/)                        │
│  - *.pacman (Arch Linux)                               │
│  - *.deb (Debian/Ubuntu)                               │
│  - *.rpm (Fedora/RHEL)                                 │
│  - *.AppImage (Universal Linux)                        │
│  - *.tar.gz (Portable)                                 │
│  - *.flatpak (Sandbox)                                 │
│  - *.exe (Windows)                                     │
│  - *.dmg (macOS)                                       │
└─────────────────────────────────────────────────────────┘
```

## 🚀 Gyors Start

### 1. Szükséges csomagok telepítése (csak első futtatás)

```bash
cd /mnt/raid/Source/mc_poke
npm install
```

### 2. Build szerver indítása

**Opció A: Menüvel**
```bash
./start-build-server.sh
```

**Opció B: Közvetlen**
```bash
npm run build-server
# vagy
node build-server.js
```

**Opció C: Egyéni porttal**
```bash
PORT=8080 npm run build-server
```

### 3. Böngészőből

Nyiss meg: **http://localhost:3000**

Máris lehet:
- ✅ Kattintani a `🚀 Build` gombokra
- ✅ Valós idejű output megtekintése
- ✅ Parancsok másolása
- ✅ Téma váltása (Dark/Light)

## 📦 Fájlok Referenciája

### szerver
| Fájl | Leírás |
|------|--------|
| `build-server.js` | Node.js Express szerver, API & WebSocket |
| `BUILD_SERVER.md` | Szerver dokumentáció |
| `start-build-server.sh` | Szerver gyors indítása |

### Grafikus interfész
| Fájl | Leírás |
|------|--------|
| `build-client-dashboard.html` | Interaktív web dashboard |
| **Funkciók:** | Szép UI, Build gombok, Valós idejű output |

### Build scriptek - Linux
| Fájl | Formátum | Paltform |
|------|----------|----------|
| `build-client-linux.sh` | Összes | Linux (összes) |
| `build-client-linux-arch.sh` | pacman | Arch Linux |
| `build-client-linux-debian.sh` | deb | Debian/Ubuntu |
| `build-client-linux-redhat.sh` | rpm | Fedora/RHEL |
| `build-client-linux-appimage.sh` | AppImage | Universal Linux |
| `build-client-linux-targz.sh` | tar.gz | Portable |
| `build-client-linux-flatpak.sh` | flatpak | Sandbox |

### Build scriptek - Egyéb
| Fájl | Formátum | Platform |
|------|----------|----------|
| `build-client-win.sh` | exe | Windows |
| `build-client-mac.sh` | dmg | macOS |

### CLI scriptek
| Fájl | Leírás |
|------|--------|
| `build-client.sh` | Interaktív menu CLI |
| `BUILD_CLIENT.md` | CLI dokumentáció |
| `BUILD_QUICK_REF.sh` | Gyorsreferencia |

## 🌐 Böngészős Interfész Funkciók

### ✨ UI Jellemzők
- 🎨 Modern gradient design
- 🌓 Dark/Light mód
- 📱 Reszponzív mobil-barát
- ✨ Animációk és hover effektek

### 🎯 Kategóriák
1. **Linux - Összes Formátum** (6 csomagolás típus)
2. **Linux - egyéb** (Arch, Debian, Fedora stb.)
3. **Windows** (NSIS, Portable)
4. **macOS** (DMG)
5. **Gyors Start** (Interaktív builder)
6. **Parancssori Ref** (Összes argumentum)

### 🔘 Build Gombok
- `🚀 Build` - Szerver-es build indítása
- `📋 Másolás` - Parancs vágólapra másolása

## 🔗 API Referencia

### Build indítása
```
POST http://localhost:3000/api/build/:type

Típusok:
- linux-arch, linux-debian, linux-redhat
- linux-appimage, linux-targz, linux-flatpak
- linux-all
- windows, macos

Válasz:
{ "status": "success", "message": "Build elindítva" }
```

### Status lekérése
```
GET http://localhost:3000/api/status

Válasz:
{ "building": true/false, "projectRoot": "..." }
```

### WebSocket Events
```javascript
// Build indítása
{ type: "start", buildType: "linux-arch", ... }

// Output
{ type: "output", text: "..." }

// Siker
{ type: "success", title: "✅", ... }

// Hiba
{ type: "error", title: "❌", ... }
```

## 📋 Munkamenet Típusok

### 1. Böngészőből (Ajánlott)
```
1. Nyiss: http://localhost:3000
2. Válassz platformot
3. Kattints: 🚀 Build
4. Nézd az outputot valós időben
```

### 2. Terminálból (CLI)
```bash
# Interaktív menü
./build-client.sh

# Közvetlenül egy platformra
./build-client.sh linux-arch

# Összes platform
./build-client.sh all
```

### 3. npm scriptől
```bash
npm run dist:linux      # Linux összes
npm run dist:win        # Windows
npm run dist:mac        # macOS
npm run dist:flatpak    # Flatpak
```

## ⚙️ Konfiguráció

### Port váltása
```bash
PORT=8080 npm run build-server
```

### Fejlesztői mód
```bash
DEBUG=* npm run build-server
```

### Statikus mód (csak HTML)
```bash
npx http-server -p 3000
```

## 🔒 Biztonság

- ✅ Szerver csak localhost-on hallgat (alapértelmezően)
- ✅ Csak projekt-gyökér scripteket futtathat
- ✅ Child process isolation
- ✅ Input validation az API-kon

## 🐛 Hibaelhárítás

### "Port már használatban"
```bash
PORT=3001 npm run build-server
```

### "Script nem található"
```bash
cd /mnt/raid/Source/mc_poke
npm run build-server
```

### WebSocket kapcsolati hiba
1. Frissítsd az oldalt (F5)
2. Nézd meg a konzolt (F12 → Console)
3. Ellenőrizd, hogy a szerver fut-e

### Build hiba az outputban
- Nézd meg a terminál outputot ahol a szerver fut
- Ellenőrizd, hogy az összes build script futtatható-e
- Nézd meg az npm dependenciákat

## 📝 Logging

Szerver naplózás:
```
[WS] Kliens csatlakozott
[BUILD] Indítva: linux-arch
[WS] Üzenet: ...
```

Böngészői console (F12):
```javascript
[WS] Csatlakozva
[BUILD] Indítva: linux-arch
[BUILD] Output: ...
```

## 🚀 Fejlesztői Tippek

### Custom port 3000 helyett
```bash
PORT=3000 npm run build-server
# Nyiss: http://localhost:3000
```

### Több Node.js verzió kezelés
```bash
nvm use 18  # vagy a kívánt verzió
npm run build-server
```

### Build script debug
```bash
bash -x build-client-linux-arch.sh
```

## 📚 További Dokumentáció

- `BUILD_SERVER.md` - Szerver részletei
- `BUILD_CLIENT.md` - CLI build scriptek
- `BUILD_QUICK_REF.sh` - Gyorsreferencia

## 💡 Best Practices

1. **Szerver futása**: Futtasd a szervert egy dedikált terminálon
2. **Böngészői tab**: Tartsd nyitva az http://localhost:3000-et
3. **Output monitorozása**: Nézd a modálablakban az outputot
4. **Hibákat keress**: Az outputban a piros sorok = hibák
5. **Long builds**: Ne zárd be a böngészőt, amíg build fut

## 🎯 Kiadási Munkafolyamat

```
1. npm run build-server indítása
2. http://localhost:3000 megnyitása
3. Platform választása
4. 🚀 Build gomb
5. Valós idejű output megtekintése
6. web-installer/releases-ben az output
7. Tesztelés & verziókezelés
```

---

**Üdülj jól buildelmezéssel!** 🎮✨

Kérdések? Nézd meg a BUILD_SERVER.md dokumentációt!
