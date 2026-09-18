/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'privacy.js'), 'utf8');

function boot(html) {
  document.body.innerHTML = html;
  // Modul frisch laden, damit jeder Test bei Null anfaengt
  delete window.Privacy;
  // eslint-disable-next-line no-new-func
  new Function(SRC).call(window);
  window.Privacy.init();
  return window.Privacy;
}

const DASHBOARD = `
  <div id="overview">
    <div class="metric-value" id="mProfit">1.234,56€</div>
    <div class="metric-value" id="mRevenue">1.234,56€</div>
    <div class="mv-stat"><div class="v" id="mvSold">12</div></div>
    <div class="item-row">
      <div class="item-title">Nike Dunk Low</div>
      <div class="item-meta">18.09.2026</div>
      <div class="col-num">89,90€</div>
    </div>
  </div>`;

beforeEach(() => {
  localStorage.clear();
  jest.useRealTimers();
});

function textOf(sel) {
  return document.querySelector(sel).textContent;
}

// Scramble- bzw. Reveal-Animation auslaufen lassen
const settled = () => new Promise((r) => setTimeout(r, 1200));

test('ohne Privacy-Modus bleibt alles unveraendert', () => {
  boot(DASHBOARD);
  expect(textOf('#mProfit')).toBe('1.234,56€');
  expect(document.querySelectorAll('.pv-val').length).toBe(0);
});

test('Toggle maskiert Betraege und Stueckzahlen', async () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  expect(Privacy.isOn()).toBe(true);
  await settled();
  expect(textOf('#mProfit')).not.toBe('1.234,56€');
  expect(textOf('.col-num')).not.toBe('89,90€');
  expect(textOf('#mvSold')).not.toBe('12');
});

test('Maske ist exakt so lang wie der echte Wert (kein Layout-Sprung)', async () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  await settled();
  expect(textOf('#mProfit')).toHaveLength('1.234,56€'.length);
  expect(textOf('#mvSold')).toHaveLength('12'.length);
});

test('gleiche Betraege bekommen unterschiedliche Masken', async () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  await settled();
  expect(textOf('#mProfit')).not.toBe(textOf('#mRevenue'));
});

test('Maske bleibt ueber Re-Renders stabil', async () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  await settled();
  const before = textOf('#mProfit');
  Privacy.refresh();
  Privacy.refresh();
  expect(textOf('#mProfit')).toBe(before);
});

test('Artikelnamen und Datumsangaben bleiben lesbar', async () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  await settled();
  expect(textOf('.item-title')).toBe('Nike Dunk Low');
  expect(textOf('.item-meta')).toBe('18.09.2026');
});

test('Ausschalten stellt die echten Werte wieder her', async () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  await settled();
  Privacy.toggle();
  expect(Privacy.isOn()).toBe(false);
  await settled(); // Reveal-Animation abwarten
  expect(textOf('#mProfit')).toBe('1.234,56€');
  expect(document.querySelectorAll('.pv-val').length).toBe(0);
});

test('Zustand wird pro Geraet gemerkt und beim Laden angewendet', () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  expect(localStorage.getItem('resell.privacy')).toBe('1');

  // Neuer Seitenaufruf mit demselben localStorage
  const fresh = boot(DASHBOARD);
  expect(fresh.isOn()).toBe(true);
  expect(textOf('#mProfit')).not.toBe('1.234,56€');
});

test('nachgerenderte Zeilen werden automatisch maskiert', (done) => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  const row = document.createElement('div');
  row.className = 'col-num';
  row.textContent = '555,00€';
  document.getElementById('overview').appendChild(row);
  // MutationObserver-Callback laeuft als Microtask vor dem naechsten Paint
  setTimeout(() => {
    expect(row.textContent).not.toBe('555,00€');
    expect(row.textContent).toHaveLength('555,00€'.length);
    done();
  }, 0);
});

test('body bekommt die Klasse fuer die Chart-Unkenntlichmachung', () => {
  const Privacy = boot(DASHBOARD);
  Privacy.toggle();
  expect(document.body.classList.contains('privacy-on')).toBe(true);
  Privacy.toggle();
  expect(document.body.classList.contains('privacy-on')).toBe(false);
});
