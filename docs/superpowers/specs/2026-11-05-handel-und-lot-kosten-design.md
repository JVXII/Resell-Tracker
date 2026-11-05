# Design: Bereiche Reselling/Handel, Stückkosten und Versand bei Lots

Datum: 2026-11-05 · Status: freigegeben

## Problem

1. **Rechenfehler:** Teil-Verkäufe haben Kostenbasis 0, der Lot-Kopf steht nie auf
   „Verkauft“. Der Lot-Einkauf wird dadurch nie vom Gesamtprofit abgezogen, und er
   bleibt dauerhaft im Lagerwert (Kapital zu hoch). Live: 520,61 € statt 450,40 €.
2. **Fehlende Kennzahlen:** Beim Handel mit Ware auf Vorrat zählen zwei Dinge: der
   Gewinn pro Stück und ab wann die ganze Bestellung im Plus ist.
3. **Versand:** Selbst bezahlter Versand lässt sich nicht erfassen.
4. **Trennung:** Reselling und Handel lassen sich nicht getrennt auswerten.

## Entscheidungen (mit Nutzer geklärt)

- **Gemeinsamer Geldtopf:** Umschalter Alle / Reselling / Handel filtert Auswertungen.
  Bargeld und Kapital bleiben gemeinsam.
- **Ausgaben bleiben gemeinsam.** Der Netto-Profit erscheint nur unter „Alle“.
- **Der Bereich heißt „Handel“**, nicht Dropshipping (der Nutzer lagert und versendet selbst).
- **Stückzahl ist bei neuen Lots Pflicht.** Lots ohne Stückzahl werden nicht besonders verwaltet.

## Rechenmodell (`public/calc.js`)

Die einzige Stelle mit Geldlogik; `index.html` rechnet nicht mehr selbst.

```
Stückzahl  qty       = max(lot_qty || 1, verkaufte Teile)
Stückkosten          = effektiver Einkauf des Lots / qty
Kosten eines Verkaufs = Teil: Stückkosten des Lots · Einzelartikel: effektiver Einkauf
Gewinn eines Verkaufs = sell_price − shipping_cost − Kosten
Lagerwert eines Lots  = Stückkosten × (qty − verkaufte Teile)
Bargeld  = Start − Σ eff. Einkauf + Σ (sell_price − shipping_cost) − Σ Ausgaben
Kapital  = Bargeld + Lagerwert
```

- `qty` wächst mit, wenn mehr verkauft wird als angegeben. Die Kosten werden so nie
  mehrfach verteilt. Das deckt auch alte Lots ohne Stückzahl ab: Sie buchen ab dem
  ersten Verkauf ihre vollen Kosten.
- Ein Lot-Kopf ist nie selbst ein Verkauf, auch nicht mit Status „Verkauft“.
- Ein Lot ohne Reststück gilt in Listen und Filtern als „Verkauft“.
- Umsatz bleibt der volle `sell_price`.
- Prüfsumme, die immer gelten muss: Bargeld + Lagerwert = Start + Gesamtprofit − Ausgaben.

**Lot-Kennzahlen:** verkaufte Stück, Restmenge, realisierter Gewinn (Σ Stückgewinne),
Bestell-Ergebnis (Σ Netto-Erlös − Einkauf), Stück bis zur Gewinnzone
(`ceil((Einkauf − Netto-Erlös) / (part_price − part_shipping))`).

## Datenbank

Neue Spalten an `items` (idempotente Migration):

| Spalte          | Typ     | Default     | Bedeutung                           |
|-----------------|---------|-------------|-------------------------------------|
| `segment`       | TEXT    | 'reselling' | `reselling` oder `handel`           |
| `shipping_cost` | REAL    | 0           | selbst bezahlter Versand je Verkauf |
| `lot_qty`       | INTEGER | NULL        | Stückzahl (nur Lot)                 |
| `part_shipping` | REAL    | NULL        | Standard-Versand je Teil (nur Lot)  |

Teile erben den Bereich zur Laufzeit von ihrem Lot; ihre eigene Spalte wird ignoriert.

## Backend (`routes/items.js`)

- INSERT, PUT, Export und Import kennen die vier Felder.
- Validierung: `segment` aus der Liste, `shipping_cost`/`part_shipping` ≥ 0.
- Lots brauchen beim Anlegen und beim Setzen von `is_lot`/`lot_qty` eine ganze `lot_qty` ≥ 1.
- Import bleibt tolerant (alte Backups haben keine Stückzahl).

## Frontend (`public/index.html`)

- **Umschalter** oberhalb der Tabs Übersicht, Auswertung und Finanzen, Auswahl in
  `localStorage['resell.scope']`. Gefiltert: Profit, Umsatz, Verkäufe, Lagerwert,
  Artikelliste, Charts, Plattformen. Gemeinsam: Bargeld, Kapital, Ausgaben.
- **Artikel-Formular:** Bereichsschalter (Vorgabe: aktiver Bereich), Versandfeld im
  Verkaufsblock, bei Lots Stückzahl, Verkaufspreis, Versand und eine Live-Vorschau.
- **Teil-Dialog:** Versandfeld, vorbelegt aus dem Lot; Hinweis, wenn die Stückzahl
  überschritten wird.
- **Lot-Zeile:** `1/7 verkauft · +8,57 €`, darunter `Bestellung −22,79 € · noch 2 Stück bis zur Gewinnzone`.
- **Fehlerbehebungen:** Verkauf für 0 € zeigt den Verlust statt „—“ und bleibt beim Speichern
  0 statt `null`. `cashFlows` zählt vorbesessene Artikel nicht mehr als Einkauf.
  „Letzte Verkäufe“ öffnet Teile im Teil-Dialog.

## Demo (`public/demo.js`)

Liefert die neuen Felder, damit der Demo-Modus Handel und Stückkosten zeigt.

## Datenumstellung (`scripts/migrate-2026-11-handel.js`, einmalig)

Vorher `VACUUM INTO` als Backup. Die Einträge werden über ID **und** Titel geprüft; weicht
etwas ab, bricht das Skript ohne Änderung ab.

| ID | Eintrag             | Änderung                                                     |
|----|---------------------|--------------------------------------------------------------|
| 38 | Monster Plüsch Weiß | handel, `lot_qty` 5                                          |
| 39 | Totem               | handel, `lot_qty` 19                                         |
| 61 | Monster Plushi      | handel, `lot_qty` 7, `part_price` 17,99, `part_shipping` 4,19 |
| 19 | Roccat Tasten       | wird Einzelartikel „Roccat Tastatur“, verkauft für 0 €       |

Der Eintrag 19 wird nicht gelöscht, weil sonst auch die 10 € Verlust verschwänden.
Umbenennen und Verkauf des Monster Plushi erfasst der Nutzer selbst.

**Erwartung danach:** Gesamtprofit 450,40 €, Kapital −70,21 €, Bargeld unverändert.

## Bewusst weggelassen

- Ausgaben je Bereich, getrennte Geldtöpfe.
- Verkaufsgebühren als eigenes Feld.
- Nachträgliches Umrechnen alter Teil-Verkäufe auf Brutto + Versand.
