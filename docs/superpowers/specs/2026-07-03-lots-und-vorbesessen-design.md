# Design: Lots (Einzelteil-Verkäufe) + „Schon vorher besessen"

Datum: 2026-07-03 · Status: freigegeben

## Problem

Der Nutzer verkauft Einzelteile aus einem gekauften Objekt (Beispiel: einzelne
Tasten aus einer Tastatur). Er braucht:

1. Ein Objekt einmal mit Einkaufspreis erfassen und danach beliebig viele
   Einzelteile mit **je konfigurierbarem Preis** verkaufen.
2. Markieren können, dass er ein Objekt **schon vorher privat besaß**, sodass
   dessen Einkauf **nicht aufs Kapital** zählt — erst der Verkauf bringt Wert.
   Diese Funktion soll auch für normale Produkte gelten.

## Kapital-Modell heute (Ausgang)

```
Bargeld = Startkapital − Σ Einkäufe + Σ Verkäufe − Σ Ausgaben
Kapital = Bargeld + Lagerwert            (Lagerwert = Σ Einkauf unverkaufter Artikel)
Profit  = Σ (Verkaufspreis − Einkaufspreis)   über verkaufte Artikel
```
Der bestehende Haken „Privates Geld erstattet" ist rein kosmetisch (localStorage,
nur ein Punkt in der Liste) und wird von der Geldrechnung ignoriert.

## Entscheidungen (mit Nutzer geklärt)

- **Modell:** „Lot mit Einzelverkäufen" — Lot-Kopf + je Teil ein Einzelverkauf.
- **Geld-Logik für „vorbesessen":** Kostet das Business **0€**. Der Einkaufspreis
  zählt nirgends (weder Bargeld, Lager, Kapital noch als Kostenbasis). Beim
  Verkauf ist der **volle Verkaufspreis = Profit**. Der Einkaufspreis bleibt nur
  als Notiz.
- **Preis pro Teil:** Das Lot hat einen **Standard-Verkaufspreis** als Vorschlag;
  pro Verkauf überschreibbar.

## Zwei Bausteine

### Baustein 1 — Flag „Schon vorher besessen" (`owned`) auf jedem Artikel

Regel: **effektiver Einkauf = `owned ? 0 : buy_price`**. Diese eine Ersetzung in
allen Geldrechnungen genügt:

- `spentAll` (Bargeld-Abzug): nutzt effektiven Einkauf → vorbesessene Artikel
  ziehen nichts ab.
- `stockValue` (Lagerwert): nutzt effektiven Einkauf → vorbesessene Artikel
  erhöhen den Lagerwert nicht.
- `profit = sell − effektiver Einkauf` → bei `owned` ist Profit = voller Verkauf.

Umsatz, Zähler und Charts bleiben unverändert korrekt.

### Baustein 2 — Lot mit Einzelteil-Verkäufen (Wiederverwendung der items-Tabelle)

- **Lot-Kopf** = Item mit `is_lot = 1`. Hat `buy_price`, `owned`, `title`,
  `platform`, `date`, `image`, `part_price` (Standardpreis pro Teil). Status
  i. d. R. `Lager` (das Lot selbst wird nicht „verkauft").
- **Teil-Verkauf** = Item mit `parent_id = <Lot.id>`, `is_lot = 0`,
  `status = 'Verkauft'`, `sell_price` gesetzt, `buy_price = 0`, `title` = Label
  (z. B. „Taste W"), `date` = Verkaufsdatum, optional `sell_platform`.

Weil Teil-Verkäufe **ganz normale verkaufte Items** sind (Kostenbasis 0),
erscheinen sie automatisch in „Letzte Verkäufe", Profit-Chart, Umsatz und
Zählern — **keine Sonderlogik** dafür nötig.

## Datenbank

Neue Spalten an `items` (+ idempotente Migrationen):

| Spalte        | Typ     | Default | Bedeutung                                   |
|---------------|---------|---------|---------------------------------------------|
| `owned`       | INTEGER | 0       | 1 = vorbesessen, Einkauf zählt als 0        |
| `is_lot`      | INTEGER | 0       | 1 = Lot-Kopf                                |
| `parent_id`   | INTEGER | NULL    | Teil-Verkauf → zugehöriges Lot              |
| `part_price`  | REAL    | NULL    | Standard-Verkaufspreis pro Teil (nur Lot)   |

## Backend (routes/items.js)

- INSERT/UPDATE/Export/Import um die 4 Felder erweitern.
- `validateItem`: `order_nr` **nicht** verpflichtend, wenn `is_lot` oder
  `parent_id` gesetzt ist (Lots/Teile brauchen keine Bestellnummer). Fehlt
  `order_nr`, wird `''` gespeichert (Spalte ist NOT NULL).
- `allowed`-Liste (PUT) um `owned`, `is_lot`, `parent_id`, `part_price` ergänzen.
- Löschen eines Lots (`is_lot = 1`) löscht auch alle Items mit passendem
  `parent_id` (Kinder). Rechteprüfung wie gehabt.

## Frontend (public/index.html)

**Artikel-Formular:**
- Haken „Schon vorher besessen (zählt nicht aufs Kapital)".
- Haken „Als Lot (Einzelteile einzeln verkaufen)"; wenn an, erscheint Feld
  „Standard-Verkaufspreis pro Teil".

**Liste:**
- Teil-Verkäufe (`parent_id` gesetzt) erscheinen **nicht** als eigene Top-Level-
  Zeilen; sie sind unter ihrem Lot eingeklappt.
- Lot-Zeile zeigt Zusammenfassung: Einkauf · „X verkauft" · Profit (Σ Teile −
  effektiver Einkauf). Button **„+ Teil verkauft"**. Klick auf die Zeile
  klappt die Teil-Verkäufe ein/aus (zählen nicht in die Seiten-Paginierung).
- Kleiner Badge „vorbesessen" an vorbesessenen Artikeln/Lots.

**„+ Teil verkauft"-Dialog:**
- Bezeichnung (optional, Default „Teil"/laufende Nummer), Preis (vorbelegt mit
  `part_price`), Datum (heute), optional Verkaufsplattform.
- Speichern → POST eines Teil-Verkaufs (siehe oben).

**Dashboard-Rechnung:** genau eine Änderung — effektiver Einkauf
`b = i.owned ? 0 : (i.buy_price||0)` in `renderDashboard` und in der
Profit-Anzeige der Liste.

## Bewusst weggelassen (YAGNI)

- Keine Kostenverteilung des Lot-Einkaufs auf einzelne Teile.
- Kein „Rest-Lot abschließen/abschreiben" (bei vorbesessenen Lots = 0 Kosten
  unnötig; nicht-vorbesessene Lots behalten Rest-Einkauf im Lagerwert).

## Kanten

- Geteilte Ansichten bleiben schreibgeschützt.
- Bestehende Artikel: `owned=0`, `is_lot=0`, `parent_id=NULL` → Verhalten
  unverändert.
- Suche matcht Lot-Titel und Teil-Titel.
