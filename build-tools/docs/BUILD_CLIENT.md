# COBBLEMON UNIVERSE - Client Build Scripts

Ez a dokumentáció a kliens (Electron launcher) build scriptjeiről szól.

## 📋 Szervezet

### Fő script - Platformválasztó
- **`build-client.sh`** - Interaktív menüs vagy parancssori argumentumokkal működik

### Linux buildek
- **`build-client-linux.sh`** - Összes Linux formátum (AppImage, deb, rpm, pacman, tar.gz)
- **`build-client-linux-arch.sh`** - Csak Arch Linux (pacman)
- **`build-client-linux-debian.sh`** - Csak Debian/Ubuntu (deb)
- **`build-client-linux-redhat.sh`** - Csak Red Hat/Fedora (rpm)
- **`build-client-linux-appimage.sh`** - AppImage (x64 & arm64)
- **`build-client-linux-targz.sh`** - TAR.GZ (x64 & arm64)
- **`build-client-linux-flatpak.sh`** - Flatpak

### Egyéb platformok
- **`build-client-win.sh`** - Windows (NSIS installer & Portable)
- **`build-client-mac.sh`** - macOS (DMG)

---

## 🚀 Gyors használat

### 1. Interaktív menü (ajánlott)
```bash
./build-client.sh
```
Ez megjelenít egy menüt, ahol kiválaszthatod a platformot.

### 2. Parancssori argumentumokkal
```bash
# Linux - összes formátum
./build-client.sh linux-all

# Arch Linux csak
./build-client.sh linux-arch

# Debian/Ubuntu csak
./build-client.sh linux-debian

# Red Hat/Fedora csak
./build-client.sh linux-redhat

# AppImage
./build-client.sh linux-appimage

# TAR.GZ
./build-client.sh linux-targz

# Flatpak
./build-client.sh linux-flatpak

# Windows
./build-client.sh windows

# macOS
./build-client.sh macos

# Összes platform
./build-client.sh all
```

### 3. Platform-specifikus scripteknek
```bash
# Összes Linux
./build-client-linux.sh

# Arch Linux
./build-client-linux-arch.sh

# Debian/Ubuntu
./build-client-linux-debian.sh

# Red Hat/Fedora
./build-client-linux-redhat.sh

# AppImage
./build-client-linux-appimage.sh

# TAR.GZ
./build-client-linux-targz.sh

# Flatpak
./build-client-linux-flatpak.sh

# Windows
./build-client-win.sh

# macOS
./build-client-mac.sh
```

---

## 📦 Output lokáció

Minden build a `web-installer/releases/` könyvtárba kerül.

### Arch Linux / Pacman
```
web-installer/releases/Cobblemon-Universe-x64.pacman
```

### Debian/Ubuntu
```
web-installer/releases/Cobblemon-Universe-x64.deb
```

### Red Hat/Fedora
```
web-installer/releases/Cobblemon-Universe-x64.rpm
```

### AppImage
```
web-installer/releases/Cobblemon-Universe-x64.AppImage
web-installer/releases/Cobblemon-Universe-arm64.AppImage
```

### TAR.GZ
```
web-installer/releases/Cobblemon-Universe-x64.tar.gz
web-installer/releases/Cobblemon-Universe-arm64.tar.gz
```

### Flatpak
```
web-installer/releases/Cobblemon-Universe.flatpak
```

### Windows
```
web-installer/releases/Cobblemon-Universe-Setup-x64.exe
web-installer/releases/Cobblemon-Universe-Setup-arm64.exe
web-installer/releases/Cobblemon-Universe-x64.exe (portable)
web-installer/releases/Cobblemon-Universe-arm64.exe (portable)
```

### macOS
```
web-installer/releases/Cobblemon-Universe-x64.dmg
```

---

## 🔧 Előfeltételek

### Node.js & npm
```bash
# Ubuntu/Debian
sudo apt-get install nodejs npm

# Fedora/RHEL
sudo dnf install nodejs npm

# Arch Linux
sudo pacman -S nodejs npm

# macOS (Homebrew)
brew install node
```

### Linux specifikus (opcionális)
- **AppImage buildhez**: Docker vagy gépre telepített build tools
- **Flatpak buildhez**: `flatpak` csomag telepítve
- **RPM buildhez**: `rpm` csomag
- **DEB buildhez**: `dpkg` csomag

---

## 🐧 Linux Disztribúciók Útmutatása

### Arch Linux
```bash
./build-client-linux-arch.sh
```
Ez egy `.pacman` csomagot hoz létre, amely `pacman -U` paranccsal telepíthető.

### Debian/Ubuntu
```bash
./build-client-linux-debian.sh
```
Ez egy `.deb` csomagot hoz létre, amely `apt` vagy `dpkg` paranccsal telepíthető.

### Red Hat/Fedora/CentOS
```bash
./build-client-linux-redhat.sh
```
Ez egy `.rpm` csomagot hoz létre, amely `dnf` vagy `rpm` paranccsal telepíthető.

### Flatpak
```bash
./build-client-linux-flatpak.sh
```
Ez egy Flatpak csomagot hoz létre, amely `flatpak install` paranccsal telepíthető.

### AppImage (Universal)
```bash
./build-client-linux-appimage.sh
```
Ez egy AppImage fájlt hoz létre, amely bármelyik Linux disztribúción futtatható.

---

## ⚙️ Build Folyamat

Minden build script a következő lépéseket végzi:

1. **Vite build** - Az UI-t builteli TypeScript/JavaScript kódból
2. **Release könyvtár megtisztítása** - Régi buildek törlése
3. **Electron Builder** - A platform-specifikus csomag elkészítése

---

## 🔄 CI/CD Integráció

### GitHub Actions Workflow Minta

```yaml
name: Build Client

on:
  push:
    tags:
      - 'v*'

jobs:
  build-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: ./build-client-linux.sh

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: .\build-client-win.sh

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: ./build-client-mac.sh
```

---

## 🐛 Troubleshooting

### `npm: command not found`
**Megoldás**: Telepítsd a Node.js-t és az npm-et (lásd Előfeltételek).

### Nincs megfelelő build fájl
**Megoldás**: Biztos, hogy a script futott-e teljesen? Nézd meg az error üzeneteket.

### Windows build nem működik Linux-on
**Megoldás**: Windows build csak Windows-on működik. Linux-on használd az AppImage-et.

### macOS build nem működik nem-macOS rendszeren
**Megoldás**: macOS build csak macOS-en működik.

---

## 📝 Egyéb npm scriptek

Ha közvetlenül az npm-et szeretnéd használni:

```bash
# Vite build
npm run build

# Electron fejlesztési mód
npm run dev

# Electron indítása
npm run electron

# Specifikus platformokra
npm run dist:linux    # Összes Linux
npm run dist:win      # Windows
npm run dist:mac      # macOS
npm run dist:flatpak  # Flatpak

# Web installer serve (fejlesztéshez)
npm run serve:web
```

---

## 📄 Konfigurációs fájlok

- **`package.json`** - Projekt dependenciák és build konfig
- **`vite.config.js`** - Vite bundler konfig
- **`electron/main.js`** - Electron főfolyamat
- **`build-assets/icons/`** - Ikonok mindegyik platformhoz

---

## 🎯 Jó tanácsok

1. **Csendes build**: Az összes script csendes, gördülékeny outputtal
2. **Gyors iteráció**: Ha gyakran buildelsz, a platform-specifikus scripteket használd
3. **Teljes build**: Ha mindent frissíteni kell, a `build-client.sh all` a legjobb
4. **Arch Linux teszt**: `./build-client-linux-arch.sh` sok időt takarít meg, ha csak a pacman csomagot kell

---

Üdülj jól buildelmezéssel! 🎮✨
