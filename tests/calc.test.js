const Calc = require('../public/calc.js');

const lot = (o) => ({ id: 1, is_lot: 1, status: 'Gekauft', buy_price: 36.59, owned: 0, lot_qty: 7, part_price: 17.99, part_shipping: 4.19, segment: 'handel', ...o });
const part = (o) => ({ id: 100, parent_id: 1, status: 'Verkauft', buy_price: 0, sell_price: 17.99, shipping_cost: 4.19, ...o });
const parts = (n, o) => Array.from({ length: n }, (_, k) => part({ id: 100 + k, ...o }));

test('Monster-Beispiel: Gewinn pro Stück', () => {
  const items = [lot(), part()];
  expect(Calc.saleProfit(items[1], items)).toBeCloseTo(8.57, 2);
});

test('Monster-Beispiel: Lot-Kennzahlen nach einem Verkauf', () => {
  const items = [lot(), part()];
  const s = Calc.lotStats(items[0], items);
  expect(s.soldCount).toBe(1);
  expect(s.remaining).toBe(6);
  expect(s.realized).toBeCloseTo(8.57, 2);
  expect(s.orderResult).toBeCloseTo(-22.79, 2);
  expect(s.toBreakEven).toBe(2);
  expect(s.stockValue).toBeCloseTo(31.36, 2);
});

test('Monster-Beispiel: Gewinnzone ab dem 3. Stück, 60,01 € wenn alle verkauft', () => {
  const zero = [lot()];
  expect(Calc.lotStats(zero[0], zero).toBreakEven).toBe(3);
  const all = [lot(), ...parts(7)];
  const s = Calc.lotStats(all[0], all);
  expect(s.realized).toBeCloseTo(60.01, 2);
  expect(s.orderResult).toBeCloseTo(60.01, 2);
  expect(s.toBreakEven).toBe(0);
  expect(s.remaining).toBe(0);
  expect(s.stockValue).toBeCloseTo(0, 2);
});

test('Gewinnzone unbekannt, wenn kein positiver Stückerlös hinterlegt ist', () => {
  const items = [lot({ part_price: null, part_shipping: null })];
  expect(Calc.lotStats(items[0], items).toBreakEven).toBeNull();
});

test('mehr Verkäufe als Stückzahl: Kosten werden nicht mehrfach abgezogen', () => {
  const items = [lot({ lot_qty: 2, buy_price: 10, part_price: 5, part_shipping: 0 }), ...parts(4, { sell_price: 5, shipping_cost: 0 })];
  const s = Calc.lotStats(items[0], items);
  expect(s.qty).toBe(4);
  expect(s.realized).toBeCloseTo(10, 2);
  expect(s.stockValue).toBeCloseTo(0, 2);
});

test('altes Lot ohne Stückzahl bucht ab dem ersten Verkauf die vollen Kosten', () => {
  const none = [lot({ lot_qty: null, buy_price: 10 })];
  expect(Calc.lotStats(none[0], none).stockValue).toBeCloseTo(10, 2);
  const items = [lot({ lot_qty: null, buy_price: 10 }), ...parts(2, { sell_price: 8, shipping_cost: 0 })];
  const s = Calc.lotStats(items[0], items);
  expect(s.realized).toBeCloseTo(6, 2);
  expect(s.stockValue).toBeCloseTo(0, 2);
});

test('vorbesessenes Lot: Teile sind voller Gewinn nach Versand', () => {
  const items = [lot({ owned: 1 }), part()];
  expect(Calc.saleProfit(items[1], items)).toBeCloseTo(13.8, 2);
  expect(Calc.lotStats(items[0], items).stockValue).toBe(0);
});

test('Einzelartikel: Versand mindert Gewinn, Verlust bei 0 €', () => {
  const a = { id: 2, status: 'Verkauft', buy_price: 10, sell_price: 30, shipping_cost: 5 };
  const loss = { id: 3, status: 'Verkauft', buy_price: 10, sell_price: 0 };
  expect(Calc.saleProfit(a, [a])).toBe(15);
  expect(Calc.saleProfit(loss, [loss])).toBe(-10);
});

describe('splitShipping', () => {
  test('verteilt den Versand auf die Stücke, die Summe stimmt auf den Cent', () => {
    expect(Calc.splitShipping(1.8, 3)).toEqual([0.6, 0.6, 0.6]);
    expect(Calc.splitShipping(4.19, 3)).toEqual([1.4, 1.4, 1.39]);
    expect(Calc.splitShipping(4.19, 1)).toEqual([4.19]);
    expect(Calc.splitShipping(0, 2)).toEqual([0, 0]);
  });
});

test('sales: Lot-Kopf zählt nie als Verkauf, auch nicht mit Status Verkauft', () => {
  const items = [lot({ status: 'Verkauft', sell_price: 99 }), part()];
  expect(Calc.sales(items).map((i) => i.id)).toEqual([100]);
});

test('segmentOf: Teile erben den Bereich ihres Lots, Standard ist Reselling', () => {
  const items = [lot(), part({ segment: 'reselling' }), { id: 5, status: 'Lager', buy_price: 1 }];
  expect(Calc.segmentOf(items[1], items)).toBe('handel');
  expect(Calc.segmentOf(items[2], items)).toBe('reselling');
});

test('statusOf: ausverkauftes Lot gilt als Verkauft', () => {
  const open = [lot(), part()];
  expect(Calc.statusOf(open[0], open)).toBe('Gekauft');
  const done = [lot(), ...parts(7)];
  expect(Calc.statusOf(done[0], done)).toBe('Verkauft');
  const a = { id: 2, status: 'Lager' };
  expect(Calc.statusOf(a, [a])).toBe('Lager');
});

describe('totals', () => {
  const items = [
    lot(), part(),
    { id: 2, status: 'Verkauft', segment: 'reselling', buy_price: 10, sell_price: 30, shipping_cost: 5 },
    { id: 3, status: 'Lager', segment: 'reselling', buy_price: 20 },
    { id: 4, status: 'Lager', segment: 'reselling', buy_price: 50, owned: 1 },
  ];

  test('alle Bereiche', () => {
    const t = Calc.totals(items);
    expect(t.profit).toBeCloseTo(23.57, 2);
    expect(t.revenue).toBeCloseTo(47.99, 2);
    expect(t.soldCount).toBe(2);
    expect(t.stockCount).toBe(8);
    expect(t.stockValue).toBeCloseTo(51.36, 2);
    expect(t.spent).toBeCloseTo(66.59, 2);
    expect(t.received).toBeCloseTo(38.8, 2);
  });

  test('gefiltert auf einen Bereich', () => {
    expect(Calc.totals(items, 'handel').profit).toBeCloseTo(8.57, 2);
    expect(Calc.totals(items, 'reselling').profit).toBeCloseTo(15, 2);
    expect(Calc.totals(items, 'handel').stockCount).toBe(6);
    expect(Calc.totals(items, 'reselling').stockCount).toBe(2);
  });

  test('Kapitalgleichung: Bargeld + Lager = Start + Profit − Ausgaben', () => {
    const t = Calc.totals(items);
    const start = 100, exp = 7;
    const cash = start - t.spent + t.received - exp;
    expect(cash + t.stockValue).toBeCloseTo(start + t.profit - exp, 2);
  });
});

test('Live-Daten: 520,61 € werden zu 450,40 €', () => {
  // Einzelartikel wie live zusammengefasst, Lots mit echten Verkaufserlösen
  const items = [
    { id: 1, status: 'Verkauft', buy_price: 0, sell_price: 381.41 },
    { id: 38, is_lot: 1, status: 'Gekauft', buy_price: 35.31, lot_qty: 5 },
    ...Array.from({ length: 5 }, (_, k) => ({ id: 200 + k, parent_id: 38, status: 'Verkauft', buy_price: 0, sell_price: 13.8 })),
    { id: 39, is_lot: 1, status: 'Gekauft', buy_price: 52.57, lot_qty: 19 },
    ...Array.from({ length: 9 }, (_, k) => ({ id: 300 + k, parent_id: 39, status: 'Verkauft', buy_price: 0, sell_price: 7.8 })),
    { id: 61, is_lot: 1, status: 'Gekauft', buy_price: 36.59, lot_qty: 7 },
    { id: 19, status: 'Verkauft', buy_price: 10, sell_price: 0 },
  ];
  expect(Calc.totals(items).profit).toBeCloseTo(450.40, 2);
});
