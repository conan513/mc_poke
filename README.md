# 🎮 Cobbleverse Orchestrator

Ez a projekt a **Cobbleverse** modpack és a hozzá tartozó szerver teljeskörű, platformfüggetlen ökoszisztémája. Két fő részből áll: egy egyedi Minecraft Launcher-ből (kliens) és egy Adminisztrációs Szerverből (host).

![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)

---

## 📂 Projekt Felépítés

A repó két fő alkalmazást tartalmaz:

1. **CobbleLauncher (Kliens)**: Egy Electron alapú offline Minecraft kliens.
2. **CobbleServer (Szerver)**: A Node.js alapú szerver ami hosztolja a játékot, szinkronizálja a modokat, és biztosít egy admin felületet.

---

## 🚀 1. CobbleLauncher (Kliens)

Egyedi, animált (Pokéball stílusú) indítóprogram, amivel a játékosok könnyen csatlakozhatnak a szerverhez. 

### Kliens Funkciók:
- ✅ **Automatikus Telepítés** – Beszerzi a megfelelő Java 21-et és a Fabric Loadert a futtató gép OS-étől függően.
- 👤 **Offline Profilok** – Felhasználónév megadásával működik (Microsoft fiók nem szükséges).
- 🔄 **Auto-Sync** – Indítás előtt összehasonlítja a kliens mod mappáját a szerverével, és automatikusan le- és letörli a megfelelő modokat, így a játékosnak sosem kell kézzel modokat másolnia.
- 💾 **Dinamikus RAM kiosztás** – 2/4/6/8 GB dedikálható a játéknak.

### Kliens Indítása (Fejlesztői mód)
A projekt gyökérkönyvtárában:
```bash
npm install
npm run dev
```

---

## 🛠 2. CobbleServer (Host & Admin UI)

A `/cobble-server` mappában található szerver alkalmazás egyaránt indítja magát a **Minecraft Szervert** és egy **Webes Admin Felületet**.

### Szerver Funkciók:
- 🌐 **Webes Dashboard (Admin UI)** – Beépített adminisztrációs felület (alapból: `http://localhost:7878/admin`), ahol:
  - Látod a szerver állapotát (fut, leállítva, RAM).
  - Elindíthatod / leállíthatod a Minecraft szervert a böngészőből.
- 📦 **Fejlett Mod Kereső (Modrinth API)**:
  - Beépített Kereső + Telepítő egyenesen a Dashboardon.
  - Mod részletek, képgalériák megtekintése telepítés előtt.
  - Automatikus frissítés kereső a saját modokhoz.
- 🔗 **Szinkronizációs Végpontok** – A CobbleLauncher ide csatlakozik, hogy tudja, milyen modokat kell letöltenie a játékosoknak (`GET /manifest`).

### Szerver Indítása
```bash
cd cobble-server
npm install
node server.js
```

> **Megjegyzés:** A Minecraft szerver letöltése és indítása teljesen automatikus. A letöltött szerver fájlok (és a Világ) a `cobble-server/server-data/` mappában fognak létrejönni (ezt a verziókezelő ignorálja).

---

## 🛡️ Technológiai Stack

- **Frontend / Kliens UI**: Vanilla JS, HTML, CSS (Vite építővel)
- **Kliens Csomagoló**: Electron 31
- **Minecraft Futtató**: `minecraft-launcher-core` (MCLC)
- **Szerver / API**: Node.js (beépített HTTP szerver, Express nélkül)
- **Külső API Integrációk**: Modrinth API v2

## 📝 Licensz & Megjegyzések
A launcher és a szerver offline (cracked) módban indítja a Minecraft-ot, ezáltal csak az `online-mode=false` beállítással futó környezetben használható.
