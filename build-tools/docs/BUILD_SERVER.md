# 🚀 Client Builder Server

A **build-server.js** egy Node.js Express szerver, amely biztosít egy weben keresztül érhető interaktív interfészt az összes build scriptre.

## 🎯 Funkciók

- ✅ Szép, grafikus web interfész (build-client-dashboard.html)
- ✅ WebSocket valós idejű outputtal
- ✅ API végpontok az egyes build típusokhoz
- ✅ Build status monitoring
- ✅ Terminal-szerű output megjelenítés

## 📋 Előfeltételek

### Node.js & npm

```bash
# Ubuntu/Debian
sudo apt-get install nodejs npm

# Fedora
sudo dnf install nodejs npm

# Arch
sudo pacman -S nodejs npm

# macOS (Homebrew)
brew install node
```

### Projektem függőségek telepítése

```bash
cd /mnt/raid/Source/mc_poke
npm install
```

## 🚀 Szerver indítása

### 1. Függőségek telepítése (csak első futtatáskor)
```bash
npm install
```

### 2. Szerver indítása
```bash
npm run build-server
```

Vagy közvetlenül:
```bash
node build-server.js
```

Eredmény:
```
╔════════════════════════════════════════════════════════════╗
║  🎮 COBBLEMON UNIVERSE - Client Builder Server            ║
╚════════════════════════════════════════════════════════════╝

📍 Server futása: http://localhost:3000

📋 Build scripteket megnyithatod a böngészőből!
🔗 Nyiss meg egy böngészőablakot: http://localhost:3000
```

## 🌐 Böngészőből

1. Nyiss meg a böngésződedet: **http://localhost:3000**
2. Válassz egy platformot az interfészből
3. Kattints a **🚀 Build** gombra
4. Nézd az outputot valós időben a modálablakban

## 📦 Támogatott build típusok

### Linux
- `linux-all` - Összes Linux formátum (pacman, deb, rpm, AppImage, tar.gz, flatpak)
- `linux-arch` - Arch Linux (pacman)
- `linux-debian` - Debian/Ubuntu (deb)
- `linux-redhat` - Red Hat/Fedora (rpm)
- `linux-appimage` - AppImage (x64, arm64)
- `linux-targz` - TAR.GZ (x64, arm64)
- `linux-flatpak` - Flatpak

### Egyéb platformok
- `windows` - Windows (NSIS, Portable)
- `macos` - macOS (DMG)

## 🔌 API Végpontok

### Build indítása
```
POST /api/build/:type

Paraméterek:
- type: linux-arch, linux-debian, linux-redhat, linux-appimage, linux-targz, linux-flatpak, windows, macos

Válasz:
{ "status": "success", "message": "Build elindítva" }
```

### Status lekérése
```
GET /api/status

Válasz:
{ "building": false, "projectRoot": "/path/to/project" }
```

## 🔄 WebSocket Events

### Server → Kliens

```javascript
// Build elindítása
{ 
  type: "start", 
  title: "🚀 Build indítása", 
  buildType: "linux-arch",
  message: "..." 
}

// Output sor
{ 
  type: "output", 
  text: "Building..." 
}

// Hibaüzenet output
{ 
  type: "error_output", 
  text: "Error: ..." 
}

// Build sikeres
{ 
  type: "success", 
  title: "✅ Build sikeres!", 
  message: "..."
}

// Build hiba
{ 
  type: "error", 
  title: "❌ Build hiba", 
  message: "..."
}
```

## ⚙️ Konfiguráció

### Port váltása

```bash
PORT=8080 npm run build-server
```

vagy:
```bash
PORT=8080 node build-server.js
```

Majd nyiss meg: **http://localhost:8080**

## 🐛 Hibaelhárítás

### "EADDRINUSE: port már használatban"

A 3000-es port már foglalt. Használj másik portot:
```bash
PORT=3001 npm run build-server
```

### "Script nem található"

Biztos, hogy a project gyökerében vagy?
```bash
cd /mnt/raid/Source/mc_poke
npm run build-server
```

### WebSocket kapcsolati hiba

- Ellenőrizd, hogy a szerver fut-e
- Nézd meg az eszköztárat (F12 → Console)
- Próbálj meg frissíteni az oldalt

## 📱 Remote csatlakozás

Ha a szervert egy másik gépről szeretnéd elérni:

1. Szerver indítása (az összes interfészen):
```bash
node build-server.js
```

2. Másik gépről csatlakozás:
```
http://szerver-ip:3000
```

**Figyelem**: Ez nem ajánlott éles környezetben (biztonsági kockázat).

## 🛑 Szerver leállítása

```bash
Ctrl+C
```

vagy másik terminálon:
```bash
pkill -f "node build-server.js"
```

## 📝 Naplózás

A szerver konzolra írja az összes releváns eseményt:
- `[WS]` - WebSocket eventos
- `[BUILD]` - Build folyamat eventos
- `[ERROR]` - Hibák

## 🔐 Biztonság

- ✅ A szerver csak localhost-on hallgat (alapértelmezetten)
- ✅ Csak a projekt gyökerében lévő scripteket futtathat
- ✅ Nincs hitelesítés szükséges (csak lokális használatra)

## 💡 Fejlesztői tippek

### Debug mód

```bash
DEBUG=* npm run build-server
```

### Csak az HTML kiszolgálása (statikus mód)

```bash
# Egyszerű Python server
python3 -m http.server 3000

# Vagy Node.js simple server
npx http-server -p 3000
```

---

**Üdülj jól buildelmezéssel!** 🎮✨
