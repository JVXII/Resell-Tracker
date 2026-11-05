/**
 * @jest-environment jsdom
 */
// Laedt die echte Seite mit ihrem Inline-Script gegen eine gestubbte API.
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const CALC = fs.readFileSync(path.join(PUBLIC, 'calc.js'), 'utf8');

const NOW = new Date().toISOString().slice(0, 10);
const part = (id, parent_id, sell_price, shipping_cost = 0) => ({ id, parent_id, title: 'Teil', platform: 'eBay', order_nr: '', date: NOW, sold_date: NOW, buy_price: 0, sell_price, shipping_cost, status: 'Verkauft', is_lot: 0, owned: 0 });
const ITEMS = [
  { id: 1, title: 'Monster Plushi', platform: 'eBay', order_nr: '', date: NOW, buy_price: 36.59, status: 'Gekauft', is_lot: 1, owned: 0, segment: 'handel', lot_qty: 7, part_price: 17.99, part_shipping: 4.19 },
  part(2, 1, 17.99, 4.19),
  { id: 3, title: 'Weiß', platform: 'eBay', order_nr: '', date: NOW, buy_price: 10, status: 'Gekauft', is_lot: 1, owned: 0, segment: 'handel', lot_qty: 1, part_price: 20 },
  part(4, 3, 20),
  { id: 5, title: 'Facecam', platform: 'eBay', order_nr: 'A', date: NOW, sold_date: NOW, buy_price: 50, sell_price: 80, shipping_cost: 5, status: 'Verkauft', is_lot: 0, owned: 0, segment: 'reselling' },
  { id: 6, title: 'Tastatur', platform: 'eBay', order_nr: 'B', date: NOW, sold_date: NOW, buy_price: 10, sell_price: 0, status: 'Verkauft', is_lot: 0, owned: 0, segment: 'reselling' },
  { id: 7, title: 'Drucker', platform: 'eBay', order_nr: 'C', date: NOW, buy_price: 20, status: 'Lager', is_lot: 0, owned: 0, segment: 'reselling' },
];

const responses = {
  '/auth/me': { id: 1, username: 'jan', discord_id: '1', avatar: null },
  '/api/items': ITEMS,
  '/api/profile': { balance: 100, goal: null, privateMode: true, admin: false },
  '/api/expenses': [{ id: 1, date: NOW, amount: 7, category: 'Sonstiges' }],
};

let errors;

async function boot(savedScope) {
  localStorage.clear();
  if (savedScope) localStorage.setItem('resell.scope', savedScope);
  errors = [];
  const doc = new DOMParser().parseFromString(HTML, 'text/html');
  document.body.innerHTML = doc.body.innerHTML;
  document.querySelectorAll('script').forEach((s) => s.remove());
  window.fetch = jest.fn((url) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(responses[String(url).split('?')[0]] ?? {}) }));
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.onerror = (m) => { errors.push(m); };
  const inline = [...doc.querySelectorAll('script')].filter((s) => !s.src).map((s) => s.textContent).join('\n');
  // Direkt ausgefuehrt, damit Funktionen wie auf der Seite global sind
  (0, eval)(`var Calc;(function(){var module={exports:{}};${CALC.replace('})(this);', '})({});')};Calc=module.exports;})();`);
  (0, eval)(inline.replace(/\bconst (\w+)=/g, 'var $1=').replace(/\blet (\w+)/g, 'var $1'));
  await new Promise((r) => setTimeout(r, 30));
}

const text = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ');

test('Lot-Kosten mindern Gesamtprofit und Kapital', async () => {
  await boot();
  // Stueckgewinne 8,57 + 10,00, Einzelartikel 25,00 und −10,00
  expect(text('mProfit')).toContain('33,57');
  // Bargeld: 100 − 126,59 + (13,80 + 20 + 75 + 0) − 7 = 75,21; Lager: 31,36 + 20
  expect(text('ovCash')).toContain('75,21');
  expect(text('mKapital')).toContain('126,57');
  expect(errors).toEqual([]);
});

test('der Umschalter filtert Profit, Bargeld und Kapital bleiben gemeinsam', async () => {
  await boot();
  window.setScope('handel');
  expect(text('mProfit')).toContain('18,57');
  expect(text('ovStockValue')).toContain('31,36');
  expect(text('ovCash')).toContain('75,21');
  expect(text('mKapital')).toContain('126,57');
  expect(document.getElementById('fNetCard').style.display).toBe('none');
  expect(text('tableCount')).toBe('2 Einträge');

  window.setScope('reselling');
  expect(text('mProfit')).toContain('15,00');
  expect(text('tableCount')).toBe('3 Einträge');
  expect(localStorage.getItem('resell.scope')).toBe('reselling');

  window.setScope('all');
  expect(document.getElementById('fNetCard').style.display).toBe('');
  expect(text('fNet')).toContain('26.57');
});

test('die Auswahl überlebt das Neuladen', async () => {
  await boot('handel');
  expect(text('mProfit')).toContain('18,57');
  expect(document.querySelector('#scopeBar button.active').dataset.scope).toBe('handel');
});

test('die Lot-Zeile zeigt Fortschritt und Gewinnzone', async () => {
  await boot();
  const body = text('tableBody');
  expect(body).toContain('1/7 verkauft');
  expect(body).toContain('Bestellung −22,79');
  expect(body).toContain('noch 2 Stück bis zur Gewinnzone');
  expect(body).toContain('+8,57');
});

test('ein ausverkauftes Lot zählt nicht mehr als Lagerbestand', async () => {
  await boot();
  expect(text('stockList')).not.toContain('Weiß');
  expect(text('stockList')).toContain('Monster Plushi');
  window.setFilter('Verkauft');
  expect(text('tableBody')).toContain('Weiß');
  expect(text('tableBody')).not.toContain('Monster Plushi');
});

test('ein Verkauf für 0 € zeigt den Verlust und bleibt beim Speichern 0', async () => {
  await boot();
  expect(text('tableBody')).toContain('−10,00');
  window.editItem(6);
  expect(document.getElementById('sellPrice').value).toBe('0');
  window.fetch.mockClear();
  await window.saveItem();
  const put = window.fetch.mock.calls.find(([u, o]) => o && o.method === 'PUT');
  expect(JSON.parse(put[1].body)).toMatchObject({ sell_price: 0, segment: 'reselling', shipping_cost: 0 });
});

test('Formular: Lot verlangt Stückzahl und zeigt die Vorschau', async () => {
  await boot('handel');
  window.openNewModal();
  expect(document.getElementById('segment').value).toBe('handel');
  document.getElementById('isLotChk').checked = true;
  document.getElementById('buyPrice').value = '36.59';
  document.getElementById('order').value = '';
  document.getElementById('date').value = NOW;
  window.fetch.mockClear();
  await window.saveItem();
  expect(window.fetch.mock.calls.filter(([, o]) => o && o.method === 'POST')).toHaveLength(0);

  document.getElementById('lotQty').value = '7';
  document.getElementById('partPrice').value = '17.99';
  document.getElementById('partShipping').value = '4.19';
  window.updateProfitHint();
  const preview = text('lotPreview');
  expect(preview).toContain('+8,57');
  expect(preview).toContain('im Plus ab dem 3. Stück');
  expect(preview).toContain('+60,01');
  await window.saveItem();
  const post = window.fetch.mock.calls.find(([, o]) => o && o.method === 'POST');
  expect(JSON.parse(post[1].body)).toMatchObject({ is_lot: 1, segment: 'handel', lot_qty: 7, part_price: 17.99, part_shipping: 4.19 });
});

test('Teil-Dialog: Versand ist vorbelegt und landet im Verkauf', async () => {
  await boot();
  window.openPartModal(1);
  expect(document.getElementById('partSell').value).toBe('17.99');
  expect(document.getElementById('partShip').value).toBe('4.19');
  expect(text('partHint')).toContain('+8,57');
  window.fetch.mockClear();
  await window.savePart();
  const post = window.fetch.mock.calls.find(([, o]) => o && o.method === 'POST');
  expect(JSON.parse(post[1].body)).toMatchObject({ parent_id: 1, sell_price: 17.99, shipping_cost: 4.19, buy_price: 0 });
});

test('Teil-Dialog warnt, wenn alle Stück verkauft sind', async () => {
  await boot();
  window.openPartModal(3);
  expect(text('partHint')).toContain('alle 1 Stück sind schon verkauft');
});
