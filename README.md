# 🌌 Cobblemon Universe Ecosystem

Üdvözöl a **Cobblemon Universe**, a legteljesebb és legmodernebb Pokémon élmény Minecraftban. Ez a projekt egy teljeskörű, automatizált ökoszisztémát biztosít, amely magában foglalja az egyedi launchert, a webes telepítőt és a dedikált szerverkezelő központot.

![Minecraft](https://img.shields.io/badge/Minecraft-1.21.1-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=for-the-badge)
![Languages](https://img.shields.io/badge/Languages-14+-orange?style=for-the-badge)

---

## 📂 Projekt Struktúra

A repozitórium három fő pillérre épül:

1.  **🚀 Cobblemon Universe Launcher (Kliens)**: Prémium, Electron-alapú Minecraft kliens, amely automatizálja a teljes játékélményt.
2.  **🌐 Web-Installer (Landing Page)**: Modern, reszponzív weboldal automatikus OS-felismeréssel és letöltési segédlettel.
3.  **🛠️ Universe Server Control (Host)**: Node.js alapú központi szerver, amely a játékot és a mod-szinkronizációt kezeli.

---

## 🚀 1. Cobblemon Universe Launcher

Egyedi tervezésű, vizuálisan lenyűgöző indítóprogram, amely leveszi a technikai terhet a játékosok válláról.

### Kiemelt funkciók:
*   🌍 **Többnyelvűség (i18n):** 14+ támogatott nyelv, automatikus rendszer-nyelv felismeréssel (Windows, Linux, macOS).
*   🔄 **Intelligens Mod-Szinkron:** A kliens minden indításkor ellenőrzi a szerver állapotát, és automatikusan le- vagy feltölti a szükséges modokat és konfigurációkat.
*   👤 **Skin Rendszer:** Beépített 3D skin nézegető és feltöltő felület, amely szinkronizálja a játékos megjelenését a szerverrel.
*   ⚙️ **Auto-Setup:** Automatikusan telepíti a megfelelő Java 21 környezetet és a Fabric Loadert.
*   🎨 **Prémium Design:** Kinematikus háttérképek, üveg-szerű (glassmorphism) felületek és smooth animációk.

---

## 🌐 2. Web-Installer (Landing Page)

A játékosok első érintkezési pontja, egy modern landing page, amely a `web-installer` mappában található.

*   💻 **OS Detektálás:** Automatikusan felajánlja a rendszeredhez illő telepítőt (Windows, Linux vagy Mac).
*   📦 **Minden Platform Támogatott:** Elérhető EXE, AppImage, DEB, RPM, DMG és ZIP formátumokban is.
*   📊 **Élő Szerverstátusz:** Az oldalon látható a szerver aktuális állapota, a telepített modok száma és a következő tervezett újraindítás ideje.

---

## 🛠️ 3. Universe Server Control

A központi agy, amely a `/cobble-server` mappában található.

*   🖥️ **Web Dashboard:** Teljes körű vezérlés a böngészőből (Indítás/Leállítás, RAM kezelés).
*   🔍 **Modrinth Integráció:** Beépített mod-kereső és telepítő, verziókezeléssel és frissítés-ellenőrzéssel.
*   📋 **Manifest API:** Kiszolgálja a klienseket a pontos mod-listával és konfigurációkkal.
*   👕 **Skin API:** Kezeli a játékosok skinjeit és kiszolgálja azokat a SkinsRestorer mod felé.

---

## 🛠️ Technológiai Stack

*   **Frontend:** Vanilla JS, HTML5, CSS3 (Modern design tokenekkel).
*   **Backend:** Node.js (V原生 HTTP szerver, Express nélkül a maximális sebességért).
*   **Frameworks:** Electron 31 (Launcher), Vite (Build tool).
*   **APIs:** Modrinth API v2, Cobblemon Official Metadata.

---

## 🏁 Gyors Indítás

### Kliens (Fejlesztéshez):
```bash
npm install
npm run dev
```

### Szerver indítása:
```bash
cd cobble-server
npm install
node server.js
```

### Web-Installer:
A szerver automatikusan hosztolja a `web-installer` tartalmát a `http://localhost:8080` címen.

---

## 📝 Licensz & Megjegyzések
A projekt célja a közösségi játékélmény maximalizálása. A kliens és a szerver offline (cracked) módban is üzemelhet, de javasoljuk az eredeti Minecraft használatát a Pokémon élmény teljes kiaknázásához.

© 2026 Cobblemon Universe Team
