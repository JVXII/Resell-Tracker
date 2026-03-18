# Design Spec: Webserver Migration

**Datum:** 2026-03-18
**Status:** Approved

---

## Übersicht

Migration der bestehenden HTML/localStorage-App zu einer Node.js-Server-Anwendung mit persistenter SQLite-Datenbank, Discord OAuth, Multi-User-Support und geteilten Ansichten.

---

## Architektur

**Stack:**
- `express` – HTTP-Server
- `better-sqlite3` – synchrones SQLite, kein Callback-Overhead
- `express-session` + `connect-sqlite3` – persistente Sessions (überleben Server-Restart)
- Discord OAuth2 direkt via `fetch` – kein Passport.js

**Deployment:** Einzelner VPS, Node.js-Prozess (z.B. via PM2)

**Projektstruktur:**
```
resell-tracker/
├── server.js               # Express-Einstiegspunkt
├── db.js                   # SQLite-Setup & Migrationen
├── routes/
│   ├── auth.js             # Discord OAuth Flow
│   ├── items.js            # CRUD für Produkte
│   └── share.js            # Ansicht teilen / Mitglieder verwalten
├── middleware/
│   └── auth.js             # Session-Check Middleware
├── public/
│   ├── index.html          # Frontend (angepasst)
│   ├── login.html          # Neue Login-Seite mit Discord-Button
│   └── chart.js            # unverändert
├── data/
│   └── resell.db           # SQLite-Datenbankdatei
├── .env                    # Discord Client ID/Secret, Session Secret
└── package.json
```

---

## Datenbank-Schema

### `users`
| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | INTEGER PK | Auto-increment |
| discord_id | TEXT UNIQUE | Discord User ID |
| username | TEXT | Discord-Name |
| avatar | TEXT | Avatar-Hash für Profilbild |

### `items`
| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | INTEGER PK | |
| owner_id | INTEGER FK → users | Eigentümer des Produkts |
| platform | TEXT | eBay, Kleinanzeigen, … |
| order_nr | TEXT | Bestellnummer |
| date | TEXT | YYYY-MM-DD |
| buy_price | REAL | Einkaufspreis in € |
| sell_price | REAL | Verkaufspreis in € |
| status | TEXT | Gekauft / Lager / Verkauft |
| tracking | TEXT | Tracking-URL |
| image | TEXT | base64 JPEG (max 900×900, quality 0.75) |
| created_at | TEXT | ISO-Timestamp |

### `shared_views`
| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | INTEGER PK | |
| owner_id | INTEGER UNIQUE FK → users | Ein Eintrag pro Nutzer |
| invite_token | TEXT UNIQUE | UUID-Token für Invite-Link |

### `view_members`
| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | INTEGER PK | |
| view_id | INTEGER FK → shared_views | |
| user_id | INTEGER FK → users | Eingeladener Nutzer |
| role | TEXT | `read` oder `edit` |

---

## API-Routen

### Auth
```
GET  /auth/discord           → Weiterleitung zu Discord OAuth
GET  /auth/discord/callback  → OAuth Callback, Session anlegen/aktualisieren
POST /auth/logout            → Session löschen
```

### Produkte
```
GET    /api/items              → Eigene Produkte laden
POST   /api/items              → Produkt hinzufügen
PUT    /api/items/:id          → Bearbeiten (Owner oder edit-Member)
DELETE /api/items/:id          → Löschen (nur Owner)
POST   /api/items/import       → JSON-Backup importieren
GET    /api/items/export       → JSON-Export
```

### Geteilte Ansichten
```
POST   /api/share/invite              → Invite-Token erstellen/erneuern
GET    /api/share/join/:token         → Ansicht beitreten (nach Login)
GET    /api/share/members             → Mitgliederliste mit Rollen
PUT    /api/share/members/:userId     → Rolle ändern (read ↔ edit)
DELETE /api/share/members/:userId     → Mitglied entfernen
GET    /api/shared/:ownerId/items     → Produkte eines Owners lesen (nur Mitglieder)
```

---

## Berechtigungslogik

- **Owner:** Voller Zugriff (lesen, schreiben, löschen, teilen)
- **edit-Member:** Kann Produkte hinzufügen und bearbeiten, nicht löschen
- **read-Member:** Nur lesender Zugriff, keine Änderungen möglich
- Jede API-Route prüft Session + Berechtigungen via Middleware

---

## Frontend-Änderungen

### Neue `login.html`
- Discord-Login-Button → `/auth/discord`
- Kein Passwortfeld mehr
- Zeigt Discord-Avatar + Name nach erfolgreichem Login

### Angepasstes `index.html`
- Alle `localStorage`-Aufrufe werden durch `fetch()`-Calls gegen die API ersetzt
- Oben rechts: Discord-Avatar + Logout-Button
- Neuer "Teilen"-Bereich: Invite-Link (kopierbar) + Mitgliederliste mit Rollen-Dropdown und Entfernen-Button
- Beim Betrachten einer fremden Ansicht: Banner mit Name des Owners und eigener Rolle

### Was unverändert bleibt
- Komplettes UI-Design (Dark Theme, Tab-Struktur, Stats-Cards)
- Chart.js-Integration und Chart-Logik
- Canvas-basierte Bildoptimierung (läuft im Browser)

---

## Datenmigration

- Nutzer exportieren ihre Daten aus der alten App als JSON-Backup
- Nach erstem Discord-Login: Import-Button in der App
- `POST /api/items/import` verarbeitet das bestehende JSON-Format und legt alle Einträge dem eingeloggten User zu

---

## Umgebungsvariablen (`.env`)

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yourdomain.com/auth/discord/callback
SESSION_SECRET=
PORT=3000
```
