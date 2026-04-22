# CobbleServer – Mod Sync Szerver

## Gyors indítás

```bash
node server.js           # 7878-as port (alapértelmezett)
PORT=9000 node server.js # egyéni port
```

## Mod kezelés

1. **Mod hozzáadás**: másold a `.jar` fájlt a `mods/` mappába
2. **Mod törlés**: töröld a `.jar` fájlt a `mods/` mappából
3. **Nem kell újraindítani** – a szerver minden kérésnél frissen olvassa a mappát

A kliens launcher automatikusan szinkronizál indítás előtt.

## Végpontok

| Végpont | Leírás |
|---|---|
| `GET /` | Szerver státusz |
| `GET /manifest` | Mod lista (JSON, SHA256 hashekkel) |
| `GET /mods/:filename` | Mod fájl letöltése |

## Kliens beállítás

A launcherben add meg a szerver URL-jét:
- Helyi gép: `http://localhost:7878`
- LAN szerver: `http://192.168.1.x:7878`

## Példa manifest

```json
{
  "mods": [
    { "filename": "cobblemon-1.7.3.jar", "hash": "abc123...", "size": 12345678 },
    { "filename": "create-1.21.1.jar", "hash": "def456...", "size": 5432100 }
  ],
  "modCount": 2,
  "generatedAt": "2026-04-22T00:00:00.000Z"
}
```
