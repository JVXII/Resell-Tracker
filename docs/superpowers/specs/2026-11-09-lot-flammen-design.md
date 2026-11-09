# Design: Flammen-Bewertung für Handel-Lots

Datum: 2026-11-09 · Status: freigegeben

## Problem

Der Nutzer will bei Handel-Artikeln auf einen Blick sehen, wie gut ein Lot läuft: wie viel
weggeht, wie hoch die Marge ist und wie viel Risiko noch darin steckt.

## Bewertung (`Calc.lotHeat(lot, items, today)`)

Gilt für Lots im Bereich Handel und nutzt nur vorhandene Daten.

| Faktor | Punkte | Rechnung                                            | Voll bei       |
|--------|--------|-----------------------------------------------------|----------------|
| Tempo  | 40     | verkaufte Stück pro Woche                           | 3 Stück/Woche  |
| Marge  | 30     | realisierter Gewinn ÷ Erlös nach Versand            | 60 %           |
| Risiko | 30     | Erlös nach Versand ÷ Einkauf (zurückverdient)       | 100 %          |

- **Zeitraum fürs Tempo:** erster Verkauf bis heute, bei ausverkauften Lots bis zum letzten
  Verkauf; mindestens ein Tag. Die Lieferzeit zählt nicht.
- **Flammen:** 3 ab 90 Punkten, 2 ab 65, 1 ab 40, sonst ❄️.
- **Abkühlung** (nicht bei ausverkauften Lots): 14 Tage ohne Verkauf eine Flamme weniger,
  Text „Abgekühlt“; 30 Tage ❄️ „Eingeschlafen“.
- **Zu wenig Daten:** Unter 2 Verkäufen gibt es keine Flammen, nur „Neu“ (ausverkauft: „Ausverkauft“).
- **Text sonst:** 3 Flammen „Läuft heiß“, 2 „Läuft gut“, 1 „Läuft ruhig“, 0 „Schwach“;
  ausverkauft immer „Ausverkauft“.
- **Risikostufe:** Niedrig ab 100 % zurückverdient, Mittel ab 50 %, sonst Hoch; ausverkauft
  „Keins mehr“ oder bei nicht zurückverdientem Einkauf „Verlust“.
- Vorbesessene Lots (Einkauf 0) gelten als voll zurückverdient.

## Anzeige (`public/index.html`)

- Lot-Zeile: Flammen und Text stehen am Anfang der Fortschrittszeile, damit lange Titel sie nicht abschneiden.
- Aufgeklappt (Desktop): drei Balken mit den echten Zahlen für Tempo, Marge und Risiko, dazu der letzte Verkauf.
- Handy: Dort lassen sich Lots nicht aufklappen, deshalb stehen die Zahlen in einer kompakten Zeile.

## Bewusst weggelassen

- Einstellbare Grenzwerte in der Oberfläche; sie stehen als Konstanten in `calc.js`.
- Flammen für Einzelartikel und Reselling.
- Sortieren nach Bewertung.
