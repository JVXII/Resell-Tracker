# Plan: Bereiche Reselling/Handel, Stückkosten und Versand

Spec: `docs/superpowers/specs/2026-11-05-handel-und-lot-kosten-design.md`

1. **Rechenkern (TDD):** `tests/calc.test.js` mit dem Monster- und Live-Beispiel, dann `public/calc.js`.
2. **DB und API (TDD):** Spalten in `db.js`, Felder und Validierung in `routes/items.js`, Tests in `tests/items.test.js`.
3. **Frontend, Rechnung:** `calc.js` einbinden, alle Geldrechnungen in `index.html` auf Calc umstellen, Wiring-Test ergänzen.
4. **Frontend, Bereich:** Umschalter, gefilterte Auswertungen, Netto-Profit nur unter „Alle“.
5. **Frontend, Formulare:** Bereich, Versand, Stückzahl, Vorschau, Teil-Dialog, Lot-Zeile.
6. **Demo:** neue Felder in `public/demo.js`.
7. **Datenumstellung:** `scripts/migrate-2026-11-handel.js` mit Trockenlauf gegen eine DB-Kopie.
8. **Prüfen und deployen:** komplette Tests, Browsertest, Commit, Push, VPS-Pull, Skript ausführen, pm2-Restart, Zahlen gegen die Erwartung prüfen.
