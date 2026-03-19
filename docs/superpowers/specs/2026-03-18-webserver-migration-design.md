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
- `express-session` + `connect-sqlite3` – persistente Sessions in `data/sessions.db`, Tabelle `sessions`, TTL 7 Tage
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
│   └── auth.js             # Session-Check + Berechtigungsprüfung
├── public/
│   ├── index.html          # Frontend (angepasst)
│   ├── login.html          # Neue Login-Seite mit Discord-Button
│   └── chart.js            # unverändert
├── data/
│   ├── resell.db           # Haupt-Datenbankdatei
│   └── sessions.db         # Session-Store
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
| status | TEXT | Enum: `Gekauft`, `Lager`, `Verkauft` |
| tracking | TEXT | Tracking-URL (nullable) |
| image | TEXT | base64 JPEG, max 900×900, quality 0.75 (nullable) |
| created_at | TEXT | ISO-Timestamp, auto-gesetzt |

**Hinweis Images:** Images bleiben als base64 in SQLite gespeichert (akzeptabel für persönliches Tool mit begrenzter Nutzerzahl). Kein Filesystem-Storage erforderlich.

### `shared_views`
| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | INTEGER PK | |
| owner_id | INTEGER UNIQUE FK → users | Ein Eintrag pro Nutzer |
| invite_token | TEXT UNIQUE | UUID-Token für Invite-Link |

**Hinweis:** Jeder Nutzer hat genau eine geteilte Ansicht (eine Gruppe). Der Invite-Token kann jederzeit rotiert werden – alle bestehenden Mitglieder bleiben in `view_members` erhalten, nur der Link ändert sich.

### `view_members`
| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | INTEGER PK | |
| view_id | INTEGER FK → shared_views | |
| user_id | INTEGER FK → users | Eingeladener Nutzer |
| role | TEXT | `read` oder `edit` |

**Hinweis:** Der Owner selbst ist NICHT in `view_members`. Ownership wird ausschließlich über `shared_views.owner_id` bestimmt.

---

## API-Routen

### Auth
```
GET  /auth/discord           → Weiterleitung zu Discord OAuth (mit state-Parameter gegen CSRF)
GET  /auth/discord/callback  → OAuth Callback: state validieren, Token tauschen, Session anlegen
POST /auth/logout            → Lokale Session löschen (Discord-Token-Revocation: out of scope)
```

### Produkte
```
GET    /api/items              → Eigene Produkte laden
POST   /api/items              → Produkt hinzufügen
PUT    /api/items/:id          → Bearbeiten (Owner oder edit-Member der Ansicht)
DELETE /api/items/:id          → Löschen (nur Owner)
POST   /api/items/import       → JSON-Backup importieren
GET    /api/items/export       → JSON-Export
```

**Import-Format:** Array von Objekten im selben Format wie der bisherige JSON-Export der alten App:
```json
[
  {
    "platform": "eBay",
    "order": "123-456",
    "date": "2025-01-15",
    "buy": 50.00,
    "sell": 80.00,
    "status": "Verkauft",
    "tracking": "",
    "image": "data:image/jpeg;base64,..."
  }
]
```
Bei doppeltem `order_nr` wird der Eintrag übersprungen (kein Fehler, kein Überschreiben). Felder `sell`, `tracking`, `image` sind optional.

**Export-Format:** Gleiches Format wie Import – kompatibel mit der alten App und dem neuen Import-Endpoint.

### Geteilte Ansichten
```
POST   /api/share/invite              → Invite-Token erstellen/rotieren (nur Owner)
GET    /api/share/join/:token         → Ansicht beitreten (muss eingeloggt sein)
GET    /api/share/members             → Eigene Mitgliederliste abrufen (nur Owner)
PUT    /api/share/members/:userId     → Rolle eines Mitglieds ändern (nur `role`-Feld, nur Owner)
DELETE /api/share/members/:userId     → Mitglied entfernen (nur Owner) oder sich selbst entfernen (Member)
GET    /api/shared/:ownerId/items     → Produkte eines Owners lesen (nur Mitglieder mit read oder edit Rolle)
```

**Invite-Token:** Wiederverwendbar, kein Ablaufdatum. Owner kann jederzeit einen neuen Token generieren (alter Link ungültig, Mitglieder bleiben).

**Unauthenticated Join Flow:** Öffnet ein nicht eingeloggter Nutzer `/api/share/join/:token`, wird der Token in der Session gespeichert und der Nutzer zu Discord OAuth weitergeleitet. Nach erfolgreichem Login prüft der Callback ob ein pending Join-Token in der Session liegt – falls ja, wird der Beitritt automatisch verarbeitet und der Nutzer zur Ansicht weitergeleitet.

---

## Berechtigungslogik

| Aktion | Owner | edit-Member | read-Member |
|--------|-------|-------------|-------------|
| Eigene Produkte lesen | ✓ | – | – |
| Geteilte Produkte lesen | ✓ | ✓ | ✓ |
| Produkt hinzufügen | ✓ | ✓ | ✗ |
| Produkt bearbeiten | ✓ | ✓ | ✗ |
| Produkt löschen | ✓ | ✗ | ✗ |
| Mitglieder verwalten | ✓ | ✗ | ✗ |
| Sich selbst entfernen | – | ✓ | ✓ |
| Token rotieren | ✓ | ✗ | ✗ |

Middleware prüft für jede Route: Session vorhanden → User existiert → Berechtigung ausreichend.

---

## Sicherheit

- **CSRF:** Cookies mit `SameSite=Strict` gesetzt. Kein zusätzlicher CSRF-Token nötig.
- **OAuth State:** `GET /auth/discord` generiert einen zufälligen `state`-Parameter, der in der Session gespeichert und im Callback validiert wird.
- **Input-Validierung:** Alle API-Eingaben werden serverseitig validiert (z.B. `status` muss Enum-Wert sein, `buy_price` muss Zahl ≥ 0 sein). Ungültige Eingaben → 400 Bad Request.
- **Session Secret:** `SESSION_SECRET` muss mindestens 32 zufällige Zeichen haben (in `.env.example` dokumentiert).

---

## Frontend-Änderungen

### Neue `login.html`
- Discord-Login-Button → `/auth/discord`
- Kein Passwortfeld
- Discord-Avatar + Name werden nach Login angezeigt

### Angepasstes `index.html`
Strukturelle Änderungen:
- Alle `localStorage.getItem/setItem/removeItem`-Aufrufe → `fetch()`-Calls gegen `/api/items`
- Initialer Datenladeaufruf beim Seitenstart: `GET /api/items`
- Formular-Submit: `POST /api/items` statt localStorage-Write
- Bearbeiten/Löschen: `PUT`/`DELETE /api/items/:id`
- Oben rechts: Discord-Avatar + Username + Logout-Button (via `POST /auth/logout`)
- Neuer "Teilen"-Bereich (Button in Header): zeigt Invite-Link (kopierbar) + Mitgliederliste mit Rollen-Dropdown + Entfernen-Button
- Banner wenn fremde Ansicht aktiv: Name des Owners + eigene Rolle

### Was unverändert bleibt
- Komplettes CSS / Dark Theme
- Tab-Struktur (Übersicht / Charts)
- Chart.js-Rendering-Logik und Datenaggregation
- Canvas-basierte Bildoptimierung (läuft weiter clientseitig vor dem Upload)
- Pagination, Filter, Suchlogik (arbeiten auf lokal gecachten API-Daten)

---

## Datenmigration

1. Nutzer öffnet alte `index.html` im Browser → klickt "Backup exportieren" → erhält JSON-Datei
2. Nutzer logt sich in neue App via Discord ein
3. Nutzer klickt "Import" → wählt JSON-Datei → `POST /api/items/import`
4. Server importiert alle Einträge dem eingeloggten User zu (Duplikate per `order_nr` werden übersprungen)

---

## Versionsindikator

Ein kleiner Commit-Hash wird unten rechts im Frontend angezeigt (fixed position, sehr dezent: `font-size: 10px`, dunkelgrau).

**Server-Side:** `server.js` liest beim Start den aktuellen Git-Commit-Hash via `execSync('git rev-parse --short HEAD')`. Schlägt das fehl (z.B. kein `.git`-Verzeichnis), fällt es auf `'unknown'` zurück.

**API:** `GET /api/version` → `{ commit: "abc1234" }`

**Frontend:** `fetch('/api/version')` direkt beim Seitenload, fügt einen `<div>` mit dem Hash dynamisch in den `<body>` ein. Kein DOM-Element im HTML selbst nötig.

**Wofür:** Man sieht sofort welcher Commit gerade auf dem Server läuft. Wenn der neueste GitHub-Commit nicht übereinstimmt → Server-Neustart nötig.

---

## Umgebungsvariablen (`.env`)

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yourdomain.com/auth/discord/callback
SESSION_SECRET=                # min. 32 zufällige Zeichen
PORT=3000
```