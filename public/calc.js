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

  // Was ein Verkauf das Business gekostet hat
  function saleCost(i, items) {
    const lot = parentOf(i, items);
    if (lot) return lotStats(lot, items).unitCost;
    return i.parent_id ? 0 : effBuy(i);
  }
  function saleProfit(i, items) { return (i.sell_price || 0) - (i.shipping_cost || 0) - saleCost(i, items); }

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

  const api = { effBuy, segmentOf, inSegment, lotStats, saleCost, saleProfit, sales, statusOf, totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
