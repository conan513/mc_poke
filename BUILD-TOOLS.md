# 🎮 BUILD TOOLS - Quickstart Guide

Minden build eszköz a **`build-tools/`** mappában van.

## 🚀 Gyors indítás

### **Opció 1: Grafikus Web Interface (Ajánlott)** ✨

```bash
./build-tools/start-build-server.sh
```

Majd nyiss meg: **http://localhost:3000**

- 🎨 Szép, interaktív UI
- 🚀 Build gombok
- 📊 Valós idejű output

---

### **Opció 2: Gyors Launcher (Terminálból)**

```bash
./build
```

Interaktív menü az összes opcióval.

---

### **Opció 3: Közvetlen Build (CLI)**

```bash
./build-tools/cli/build-client-linux-arch.sh    # Arch Linux
./build-tools/cli/build-client-linux-debian.sh  # Debian
./build-tools/cli/build-client-linux-redhat.sh  # Fedora
./build-tools/cli/build-client-win.sh           # Windows
./build-tools/cli/build-client-mac.sh           # macOS
```

---

### **Opció 4: npm Parancsok**

```bash
npm run build-server         # Web szerver
npm run dist:linux           # Linux összes
npm run dist:win             # Windows
npm run dist:mac             # macOS
npm run dist:flatpak         # Flatpak
```

---

## 📁 Struktura

```
build-tools/
├── cli/              # CLI scriptek
├── server/           # Web szerver + Dashboard
├── docs/             # Dokumentáció
├── start-build-server.sh
└── README.md
```

Részletekért: **`build-tools/README.md`**

---

## 📚 Dokumentáció

- `build-tools/README.md` - Build Tools overview
- `build-tools/docs/BUILD_SERVER.md` - Web szerver
- `build-tools/docs/BUILD_CLIENT.md` - CLI buildek
- `build-tools/docs/BUILD_SYSTEM.md` - Teljes rendszer

---

**Üdülj jól buildelmezéssel!** 🎮✨
