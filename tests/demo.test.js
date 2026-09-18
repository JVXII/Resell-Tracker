/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'demo.js'), 'utf8');

let realFetch;

function boot({ active, keepStore }) {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  if (!keepStore) sessionStorage.clear();
  if (active) sessionStorage.setItem('resell.demo', '1');

  realFetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }));
  window.fetch = realFetch;
  delete window.Demo;
  // eslint-disable-next-line no-new-func
  new Function(SRC).call(window);
  window.Demo.install();
  return window.Demo;
}

const getJson = (url, opts) => window.fetch(url, opts).then((r) => r.json().then((b) => ({ status: r.status, body: b })));

// location.reload ist in jsdom nicht implementiert; leave()/enter() rufen es am
// Ende auf, der Aufruf darf den Test nicht abbrechen.
const quietReload = (fn) => { try { fn(); } catch (_) { /* jsdom-Navigation */ } };

test('ohne aktiven Demo-Modus wird nichts gepatcht', async () => {
  boot({ active: false });
  await window.fetch('/api/items');
  expect(realFetch).toHaveBeenCalledWith('/api/items');
  expect(document.getElementById('demo-banner')).toBeNull();
});

test('im Demo-Modus erreicht kein einziger Aufruf das echte Backend', async () => {
  boot({ active: true });
  await window.fetch('/api/items');
  await window.fetch('/auth/me');
  await window.fetch('/api/profile');
  await window.fetch('/api/items/1', { method: 'DELETE' });
  expect(realFetch).not.toHaveBeenCalled();
});

test('Nicht-API-Aufrufe laufen weiterhin ans Netz', async () => {
  boot({ active: true });
  await window.fetch('/resell_tracker_icon.svg');
  expect(realFetch).toHaveBeenCalled();
});

test('roter Demo-Balken wird eingeblendet und traegt einen Verlassen-Button', () => {
  boot({ active: true });
  const bar = document.getElementById('demo-banner');
  expect(bar).not.toBeNull();
  expect(bar.textContent).toMatch(/DEMO MODE/);
  expect(bar.querySelector('button').textContent).toMatch(/verlassen/i);
  expect(document.body.classList.contains('demo-mode')).toBe(true);
});

test('Demo liefert einen gefuellten, plausiblen Datensatz', async () => {
  boot({ active: true });
  const { body: items } = await getJson('/api/items');
  expect(items.length).toBeGreaterThan(20);
  expect(items.some((i) => i.status === 'Verkauft')).toBe(true);
  expect(items.some((i) => i.status === 'Lager')).toBe(true);
  expect(items.some((i) => i.is_lot === 1)).toBe(true);
  expect(items.some((i) => i.parent_id !== null)).toBe(true);
  expect(items.some((i) => i.owned === 1)).toBe(true);

  const { body: expenses } = await getJson('/api/expenses');
  expect(expenses.length).toBeGreaterThan(0);

  const { body: profile } = await getJson('/api/profile');
  expect(profile.balance).toBeGreaterThan(0);
  expect(profile.goal).not.toBeNull();
});

test('der Datensatz ist bei jedem Start identisch', async () => {
  boot({ active: true });
  const first = (await getJson('/api/items')).body.map((i) => i.title + i.buy_price);
  sessionStorage.removeItem('resell.demo.store');
  boot({ active: true });
  const second = (await getJson('/api/items')).body.map((i) => i.title + i.buy_price);
  expect(second).toEqual(first);
});

test('Anlegen, Bearbeiten und Loeschen funktioniert lokal', async () => {
  boot({ active: true });
  const before = (await getJson('/api/items')).body.length;

  const created = await getJson('/api/items', {
    method: 'POST',
    body: JSON.stringify({ platform: 'eBay', title: 'Testartikel', order_nr: 'X1', date: '2026-09-18', buy_price: 10, status: 'Gekauft' })
  });
  expect(created.status).toBe(201);
  expect((await getJson('/api/items')).body.length).toBe(before + 1);

  const id = created.body.id;
  await getJson('/api/items/' + id, {
    method: 'PUT',
    body: JSON.stringify({ platform: 'eBay', title: 'Geaendert', order_nr: 'X1', date: '2026-09-18', buy_price: 12, status: 'Lager' })
  });
  const updated = (await getJson('/api/items')).body.find((i) => i.id === id);
  expect(updated.title).toBe('Geaendert');

  await getJson('/api/items/' + id, { method: 'DELETE' });
  expect((await getJson('/api/items')).body.length).toBe(before);
});

test('ein geloeschtes Lot nimmt seine Teil-Verkaeufe mit', async () => {
  boot({ active: true });
  const items = (await getJson('/api/items')).body;
  const lot = items.find((i) => i.is_lot === 1);
  const partCount = items.filter((i) => i.parent_id === lot.id).length;
  expect(partCount).toBeGreaterThan(0);

  await getJson('/api/items/' + lot.id, { method: 'DELETE' });
  const after = (await getJson('/api/items')).body;
  expect(after.some((i) => i.id === lot.id)).toBe(false);
  expect(after.filter((i) => i.parent_id === lot.id).length).toBe(0);
});

test('Teilen und Admin-Funktionen sind in der Demo gesperrt', async () => {
  boot({ active: true });
  expect((await getJson('/api/share/invite')).status).toBe(403);
  expect((await getJson('/api/share/members')).status).toBe(403);
  expect((await getJson('/api/discord/searches')).status).toBe(403);
  expect((await getJson('/api/profile')).body.admin).toBe(false);
});

test('Verlassen raeumt Flag und Daten weg', () => {
  const Demo = boot({ active: true });
  quietReload(() => Demo.leave());
  expect(sessionStorage.getItem('resell.demo')).toBeNull();
  expect(sessionStorage.getItem('resell.demo.store')).toBeNull();
});

test('Aenderungen ueberleben einen Reload innerhalb der Demo', async () => {
  boot({ active: true });
  await getJson('/api/items', {
    method: 'POST',
    body: JSON.stringify({ platform: 'eBay', title: 'Bleibt da', order_nr: 'X2', date: '2026-09-18', buy_price: 5, status: 'Gekauft' })
  });
  // Neuer Seitenaufruf, gleiche Session
  boot({ active: true, keepStore: true });
  const titles = (await getJson('/api/items')).body.map((i) => i.title);
  expect(titles).toContain('Bleibt da');
});
