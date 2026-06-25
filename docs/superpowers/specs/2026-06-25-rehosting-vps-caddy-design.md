# Design Spec: Resell-Tracker Re-Hosting auf eigenem VPS (Caddy)

**Datum:** 2026-06-25
**Status:** Approved (Architektur), Detail-Schritte abhängig von Server-Inspektion
**Vorgänger:** [2026-03-18-webserver-migration-design.md](2026-03-18-webserver-migration-design.md)

---

## Übersicht

Der bestehende Resell-Tracker (Node.js/Express + SQLite + Discord-OAuth) wird vom
bisherigen Hoster auf den eigenen VPS umgezogen, auf dem bereits der Discord-Deal-Bot
läuft. Ziel: App wieder erreichbar machen unter einer eigenen (Sub-)Domain mit HTTPS,
ohne den laufenden Bot zu stören. Bestehende Daten werden – falls auffindbar –
übernommen.

---

## Ausgangslage (verifiziert)

- **Code ist hostneutral.** Es gibt **keine** fest verdrahteten Verweise auf einen
  konkreten Hoster (kein Railway/Render/Heroku/Vercel im Code). Die einzige
  Host-Kopplung sind Umgebungsvariablen (`DISCORD_REDIRECT_URI`) und die im
  Discord-Developer-Portal registrierte Redirect-URL. "Alte Hoster-Verweise löschen"
  reduziert sich damit auf Konfiguration.
- **Keine Daten im Repo.** Der `data/`-Ordner (mit `resell.db`) ist per `.gitignore`
  ausgeschlossen. Bestandsdaten liegen nur auf dem alten Server bzw. in lokalen Backups.
- **Backup-Dateinamen:** Hauptdatei `data/resell.db` (komplette SQLite-DB). Alternativ
  `resell-backup.json` (JSON-Export aus der App, Endpoint `GET /api/items/export`).
  `sessions.db` wird nicht benötigt.
- **Session-Store-Lücke:** `server.js` nutzt `express-session` ohne Store →
  In-Memory-Store. Logins gehen bei jedem Neustart verloren. `session-file-store` ist
  bereits Dependency, aber nicht eingebunden.
- **Laufzeit-Anforderung:** Die App nutzt Node's eingebautes `node:sqlite`
  (`DatabaseSync`). Das erfordert **Node 22.5+ (mit `--experimental-sqlite`)** oder
  **Node 24+ (ohne Flag)**. Server-Node-Version muss geprüft werden.

---

## Zielarchitektur

```
Internet → resell.<domain>            (A-Record → Server-IP)
            ↓ HTTPS (Let's Encrypt via Caddy, automatisch)
         Caddy (Reverse Proxy, TLS-Terminierung)
            ↓ reverse_proxy localhost:3000
         Node-Prozess "resell-tracker" (PM2, autostart bei Reboot)
            ↓
         data/resell.db  (SQLite-Datei auf dem Server, persistent)

         Login: Discord OAuth → Redirect https://resell.<domain>/auth/discord/callback
```

**Entscheidung Reverse Proxy:** Caddy (Variante A). Begründung: vollautomatisches
Let's-Encrypt-Zertifikat, minimale Config, kein manuelles certbot-Renewal. **Ausnahme:**
Falls die Server-Inspektion zeigt, dass für den Deal-Bot bereits **nginx** als
Reverse Proxy läuft, wird stattdessen nginx + certbot genutzt (kein zweiter Proxy auf
Port 80/443). Diese Verzweigung wird beim Server-Check final entschieden.

---

## Komponenten

| Komponente | Zweck | Anmerkung |
|------------|-------|-----------|
| Domain + DNS | Erreichbarkeit + HTTPS-Hostname | Nutzer kauft günstige Domain; A-Record (oder Sub-Domain) auf Server-IP |
| Caddy | TLS-Terminierung + Reverse Proxy | Auto-HTTPS; Default. Fallback nginx, falls bereits vorhanden |
| PM2 | Prozessmanagement, Autostart | Vermutlich bereits für den Bot installiert; App als eigener Prozess |
| Node ≥ 22.5 / 24 | Laufzeit für `node:sqlite` | Bei Bedarf via `nvm` parallel installieren, ohne Bot-Node zu ändern |
| Discord-OAuth-App | Login (`identify`) | `CLIENT_ID`/`CLIENT_SECRET` aus alter `.env` oder neu angelegt |
| `data/resell.db` | Persistente Daten | Migration aus Backup, sonst frische DB |

---

## Code-Änderungen (minimal)

1. **Persistenter Session-Store.** `session-file-store` in `server.js` einbinden
   (Store in `data/sessions/`), damit Logins Neustarts überleben. Bestehendes
   Dependency, keine neue Installation nötig.
2. **`.env.example` aktualisieren.** Redirect-URI-Kommentar auf das neue
   Domain-Schema (`https://resell.<domain>/auth/discord/callback`) anpassen.
3. Sonst **keine** Code-Änderungen für das Re-Hosting nötig (Code ist hostneutral).

Die Tests (`jest`) müssen nach der Session-Store-Änderung weiterhin grün sein
(`NODE_ENV=test` umgeht DB-/Server-Init – Session-Store darf Tests nicht brechen).

---

## Deployment-Ablauf (High-Level)

1. **Server-Inspektion (per SSH):** OS/Distro, vorhandene Node-Version, ob PM2 läuft,
   ob nginx/Caddy/anderer Proxy bereits Port 80/443 belegt, freie Ports, Server-IP.
   → Entscheidet Proxy-Variante (Caddy vs. nginx) und Node-Installationsbedarf.
2. **Node bereitstellen** (falls < 22.5): via `nvm` für den App-User installieren.
3. **Code auf Server bringen:** Git-Clone des Repos auf den Server, `npm ci`.
4. **`.env` anlegen:** `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`
   (neu generiert), `DISCORD_REDIRECT_URI=https://resell.<domain>/auth/discord/callback`,
   `NODE_ENV=production`, `PORT` (freier Port, z.B. 3000).
5. **Daten migrieren:** `resell.db` in `data/` ablegen (oder `resell-backup.json` über
   Import-Funktion nach erstem Login einspielen). Bei keinem Backup: frische DB.
6. **Prozess starten:** via PM2 (`pm2 start`, `pm2 save`, `pm2 startup`).
7. **Domain/DNS:** A-Record (Sub-Domain) auf Server-IP setzen.
8. **Proxy + HTTPS:** Caddy-Block (`resell.<domain> { reverse_proxy localhost:PORT }`)
   bzw. nginx-vHost + certbot. Zertifikat automatisch.
9. **Discord-Portal:** Neue Redirect-URI `https://resell.<domain>/auth/discord/callback`
   in der OAuth-App registrieren.
10. **Verifikation:** Seite per HTTPS aufrufen, Discord-Login durchspielen, Item
    anlegen, Neustart-Test (PM2 + Session-Persistenz), Daten sichtbar.

---

## Offene Variablen (werden bei Server-Inspektion / vom Nutzer geklärt)

- Server-OS, vorhandene Node-Version, vorhandener Reverse Proxy (Caddy vs. nginx).
- Domainname (Nutzer kauft) → konkreter DNS-Eintrag.
- Discord-`CLIENT_ID`/`CLIENT_SECRET`: aus alter `.env` wiederverwenden oder neu.
- Welches Backup vorhanden ist (`resell.db` vs. `resell-backup.json` vs. keins).

---

## Out of Scope

- Neue Features / UI-Änderungen am Tool selbst.
- Discord-Token-Revocation beim Logout (wie schon im Vorgänger-Spec).
- CI/CD-Pipeline; Deployment erfolgt manuell per SSH.
- Migration auf eine andere Datenbank (SQLite bleibt).

---

## Erfolgskriterien

- App ist öffentlich unter `https://resell.<domain>` mit gültigem TLS-Zertifikat
  erreichbar.
- Discord-Login funktioniert (Redirect-URI korrekt registriert).
- Items lassen sich anlegen/bearbeiten; Daten persistieren über Neustarts.
- App startet automatisch nach Server-Reboot (PM2) und überlebt einen Neustart ohne
  Login-Verlust (persistenter Session-Store).
- Der bestehende Discord-Deal-Bot läuft unverändert weiter.
- Keine Verweise auf den alten Hoster mehr in Config/`.env`/Discord-Portal.
