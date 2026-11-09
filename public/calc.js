/* ==========================================================================
   Geldrechnung des Trackers — die einzige Stelle mit Profit-, Lager- und
   Bargeld-Logik. Teil-Verkaeufe tragen die Stueckkosten ihres Lots, der Lot-Kopf
   selbst ist nie ein Verkauf.
   ========================================================================== */
(function (root) {
  'use strict';

  // Vorbesessene Artikel kosten das Business 0€
  function effBuy(i) { return i.owned ? 0 : (i.buy_price || 0); }

  function parentOf(i, items) { return i.parent_id ? items.find((x) => x.id === i.parent_id) || null : null; }
  function soldParts(lot, items) { return items.filter((p) => p.parent_id === lot.id && p.status === 'Verkauft'); }

  // Teile erben den Bereich ihres Lots; Altbestand ohne Angabe ist Reselling
  function segmentOf(i, items) {
    const owner = parentOf(i, items) || i;
    return owner.segment || 'reselling';
  }
  function inSegment(i, items, segment) { return !segment || segment === 'all' || segmentOf(i, items) === segment; }

  // Waechst mit, wenn mehr verkauft wird als angegeben: So werden die Kosten nie
  // mehrfach verteilt, und Lots ohne Stueckzahl buchen ab dem ersten Verkauf voll.
  function lotQty(lot, soldCount) { return Math.max(lot.lot_qty || 1, soldCount); }

  function lotStats(lot, items) {
    const parts = items.filter((p) => p.parent_id === lot.id);
    const sold = parts.filter((p) => p.status === 'Verkauft');
    const soldCount = sold.length;
    const qty = lotQty(lot, soldCount);
    const cost = effBuy(lot);
    const unitCost = cost / qty;
    const revenue = sold.reduce((s, p) => s + (p.sell_price || 0), 0);
    const net = sold.reduce((s, p) => s + (p.sell_price || 0) - (p.shipping_cost || 0), 0);
    const remaining = qty - soldCount;
    const orderResult = net - cost;
    const unitNet = (lot.part_price || 0) - (lot.part_shipping || 0);
    let toBreakEven = 0;
    if (orderResult < 0) toBreakEven = unitNet > 0 ? Math.ceil(Math.round((-orderResult / unitNet) * 1e6) / 1e6) : null;
    return { parts, sold, soldCount, qty, cost, unitCost, unitNet, revenue, net, remaining, orderResult, toBreakEven,
      realized: net - unitCost * soldCount, stockValue: unitCost * remaining };
  }

  // Grenzwerte der Flammen-Bewertung
  const HEAT = { tempoPoints: 40, marginPoints: 30, riskPoints: 30, fullPerWeek: 3, fullMargin: 0.6,
    tiers: [[90, 3], [65, 2], [40, 1]], labels: ['Schwach', 'Läuft ruhig', 'Läuft gut', 'Läuft heiß'], coolDays: 14, sleepDays: 30, minSales: 2 };

  function dayDiff(from, to) { return Math.round((Date.parse(to) - Date.parse(from)) / 864e5); }
  function share(value, full) { return Math.max(0, Math.min(1, value / full)); }

  function lotRisk(recovered, soldOut) {
    if (soldOut) return recovered >= 1 ? 'Keins mehr' : 'Verlust';
    if (recovered >= 1) return 'Niedrig';
    return recovered >= 0.5 ? 'Mittel' : 'Hoch';
  }

  // Wie gut ein Lot laeuft: Tempo, Marge und zurueckverdienter Einkauf ergeben die Flammen
  function lotHeat(lot, items, today) {
    const s = lotStats(lot, items);
    const soldOut = s.remaining === 0;
    if (s.soldCount < HEAT.minSales) return { rated: false, flames: null, label: soldOut ? 'Ausverkauft' : 'Neu' };

    const dates = s.sold.map((p) => (p.sold_date || p.date).slice(0, 10)).sort();
    const last = dates[dates.length - 1];
    // Ab dem ersten Verkauf, damit die Lieferzeit nicht als langsamer Absatz zaehlt
    const perWeek = s.soldCount / Math.max(1, dayDiff(dates[0], soldOut ? last : today)) * 7;
    const margin = s.net > 0 ? s.realized / s.net : 0;
    const recovered = s.cost > 0 ? s.net / s.cost : 1;
    const tempoScore = share(perWeek, HEAT.fullPerWeek);
    const marginScore = share(margin, HEAT.fullMargin);
    const riskScore = share(recovered, 1);
    const score = tempoScore * HEAT.tempoPoints + marginScore * HEAT.marginPoints + riskScore * HEAT.riskPoints;
    const tier = HEAT.tiers.find(([min]) => score >= min);
    let flames = tier ? tier[1] : 0;
    let label = HEAT.labels[flames];

    const daysSinceLast = dayDiff(last, today);
    if (soldOut) label = 'Ausverkauft';
    else if (daysSinceLast >= HEAT.sleepDays) { flames = 0; label = 'Eingeschlafen'; }
    else if (daysSinceLast >= HEAT.coolDays) { flames = Math.max(0, flames - 1); label = 'Abgekühlt'; }

    return { rated: true, flames, label, score, perWeek, margin, recovered, tempoScore, marginScore, riskScore,
      risk: lotRisk(recovered, soldOut), daysSinceLast };
  }

  // Was ein Verkauf das Business gekostet hat
  function saleCost(i, items) {
    const lot = parentOf(i, items);
    if (lot) return lotStats(lot, items).unitCost;
    return i.parent_id ? 0 : effBuy(i);
  }
  function saleProfit(i, items) { return (i.sell_price || 0) - (i.shipping_cost || 0) - saleCost(i, items); }

  // Ein Paket, mehrere Stueck: Versand centgenau verteilen, Restcents tragen die ersten
  function splitShipping(total, count) {
    const cents = Math.round((total || 0) * 100);
    const base = Math.floor(cents / count);
    return Array.from({ length: count }, (_, k) => (base + (k < cents % count ? 1 : 0)) / 100);
  }

  function isSale(i) { return i.status === 'Verkauft' && !i.is_lot; }
  function sales(items, segment) { return items.filter((i) => isSale(i) && inSegment(i, items, segment)); }

  // Ein Lot ohne Reststueck ist abgeschlossen, auch wenn der Kopf noch "Gekauft" sagt
  function statusOf(i, items) {
    if (!i.is_lot) return i.status;
    return lotStats(i, items).remaining === 0 ? 'Verkauft' : (i.status === 'Verkauft' ? 'Lager' : i.status);
  }

  function totals(items, segment) {
    const t = { profit: 0, revenue: 0, soldCount: 0, stockCount: 0, stockValue: 0, spent: 0, received: 0 };
    items.forEach((i) => {
      if (!inSegment(i, items, segment)) return;
      t.spent += effBuy(i);
      if (i.is_lot) {
        const s = lotStats(i, items);
        t.stockCount += s.remaining;
        t.stockValue += s.stockValue;
      } else if (isSale(i)) {
        t.profit += saleProfit(i, items);
        t.revenue += i.sell_price || 0;
        t.received += (i.sell_price || 0) - (i.shipping_cost || 0);
        t.soldCount++;
      } else if (!i.parent_id) {
        t.stockCount++;
        t.stockValue += effBuy(i);
      }
    });
    return t;
  }

  const api = { effBuy, segmentOf, inSegment, lotStats, lotHeat, saleCost, saleProfit, splitShipping, sales, statusOf, totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
