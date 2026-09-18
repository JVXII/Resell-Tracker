/* =============================================================================
 * Demo-Modus — ein komplettes Dashboard aus Platzhalterdaten, zum Vorfuehren.
 *
 * Die Demo laeuft ausschliesslich im Browser: solange sie aktiv ist, beantwortet
 * ein Mock-Router jeden Aufruf an /api/* und /auth/* aus einem lokalen Store.
 * Nichts geht ans echte Backend — die Demo kann echte Daten also weder lesen
 * noch veraendern, auch wenn man in ihr Artikel anlegt oder loescht. Beim
 * Verlassen wird der Store verworfen.
 *
 * Aktiviert wird sie ueber Einstellungen -> Developer Tools (nur Admin).
 * Oeffentliche API: Demo.install/enter/leave/isOn.
 * ========================================================================== */
(function (global) {
  'use strict';

  var FLAG_KEY = 'resell.demo';
  var STORE_KEY = 'resell.demo.store';

  /* ---- Deterministischer Zufall: derselbe Datensatz bei jeder Vorfuehrung -- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  /* ---- Der Datensatz ------------------------------------------------------
   * Fester Seed, aber Datumsangaben relativ zu heute: die Struktur ist bei jeder
   * Vorfuehrung dieselbe, das Dashboard wirkt aber nicht eingefroren. */
  var CATALOG = [
    ['Nike Dunk Low Panda 44', 'eBay', 95, 139, 'Verkauft'],
    ['Jordan 1 Mid Chicago 43', 'eBay', 120, 185, 'Verkauft'],
    ['New Balance 550 White 42', 'Kleinanzeigen', 60, 95, 'Verkauft'],
    ['Adidas Samba OG 43', 'Kleinanzeigen', 70, 118, 'Verkauft'],
    ['iPhone 12 64GB schwarz', 'Kleinanzeigen', 210, 289, 'Verkauft'],
    ['AirPods Pro 2 Gen', 'eBay', 135, 179, 'Verkauft'],
    ['Nintendo Switch OLED', 'Kleinanzeigen', 195, 245, 'Verkauft'],
    ['Sony WH-1000XM4', 'eBay', 118, 165, 'Verkauft'],
    ['Lego Star Wars 75192 UCS', 'Kleinanzeigen', 480, 640, 'Verkauft'],
    ['Nike Tech Fleece Hoodie L', 'eBay', 45, 78, 'Verkauft'],
    ['Stone Island Sweater M', 'Kleinanzeigen', 130, 210, 'Verkauft'],
    ['Carhartt Detroit Jacket L', 'eBay', 85, 142, 'Verkauft'],
    ['Yeezy Slide Onyx 44', 'eBay', 75, 0, 'Lager'],
    ['Jordan 4 Military Black 43', 'eBay', 240, 0, 'Lager'],
    ['iPad Air 4 64GB', 'Kleinanzeigen', 255, 0, 'Lager'],
    ['Nike Air Max 1 Patta 42', 'Kleinanzeigen', 165, 0, 'Lager'],
    ['Supreme Box Logo Tee M', 'eBay', 110, 0, 'Lager'],
    ['PlayStation 5 Slim Disc', 'Kleinanzeigen', 380, 0, 'Gekauft'],
    ['Apple Watch SE 44mm', 'eBay', 145, 0, 'Gekauft'],
    ['Nike Dunk Low Grey Fog 45', 'eBay', 88, 0, 'Gekauft'],
    ['Levis 501 Vintage W32', 'Kleinanzeigen', 25, 0, 'Gekauft'],
    ['Bose QC 45 schwarz', 'eBay', 130, 0, 'Gekauft']
  ];

  var LOTS = [
    {
      title: 'Sneaker-Konvolut 8 Paar',
      platform: 'Kleinanzeigen',
      buy: 320,
      partPrice: 85,
      parts: [
        ['Nike Air Force 1 42', 75],
        ['Adidas Gazelle 43', 62],
        ['Vans Old Skool 44', 48],
        ['Puma Suede 41', 39]
      ]
    },
    {
      title: 'Restposten Elektronik',
      platform: 'eBay',
      buy: 150,
      partPrice: 60,
      parts: [
        ['Anker Powerbank 20k', 28],
        ['Logitech MX Master 2S', 54],
        ['Fire TV Stick 4K', 32]
      ]
    }
  ];

  var EXPENSES = [
    [12, 'Verpackung', 'Kartons 30x20, 50 Stueck', 9.9],
    [26, 'Porto', 'DHL Paketmarken Vorrat', 42.5],
    [40, 'Abo', 'Verkaufs-Tool Monatsbeitrag', 14.99],
    [55, 'Verpackung', 'Luftpolsterfolie Rolle', 18.4],
    [74, 'Gebuehren', 'eBay Verkaufsprovision', 63.2],
    [96, 'Fahrtkosten', 'Abholung Konvolut', 22.0]
  ];

  function buildDataset() {
    var rand = rng(20260918);
    var items = [];
    var id = 1;

    CATALOG.forEach(function (row, idx) {
      var title = row[0], platform = row[1], buy = row[2], sell = row[3], status = row[4];
      // Aeltere Eintraege weiter hinten, damit der Verlauf natuerlich aussieht
      var bought = Math.round(14 + idx * 15 + rand() * 9);
      var sold = status === 'Verkauft' ? Math.max(1, bought - Math.round(8 + rand() * 25)) : null;
      items.push({
        id: id++,
        owner_id: 0,
        platform: platform,
        order_nr: 'DEMO-' + String(1000 + idx),
        title: title,
        date: daysAgo(bought),
        sold_date: sold ? daysAgo(sold) : null,
        buy_price: buy,
        sell_price: status === 'Verkauft' ? sell : null,
        sell_platform: status === 'Verkauft' ? (rand() > 0.45 ? 'eBay' : 'Kleinanzeigen') : null,
        status: status,
        tracking: status === 'Gekauft' ? '00340434' + String(100000 + idx) : null,
        image: null,
        owned: idx === 6 || idx === 20 ? 1 : 0,
        is_lot: 0,
        parent_id: null,
        part_price: null,
        created_at: daysAgo(bought) + 'T10:00:00.000Z'
      });
    });

    LOTS.forEach(function (lot, li) {
      var lotId = id++;
      var bought = 45 + li * 40;
      items.push({
        id: lotId,
        owner_id: 0,
        platform: lot.platform,
        order_nr: 'DEMO-LOT-' + (li + 1),
        title: lot.title,
        date: daysAgo(bought),
        sold_date: null,
        buy_price: lot.buy,
        sell_price: null,
        sell_platform: null,
        status: 'Lager',
        tracking: null,
        image: null,
        owned: 0,
        is_lot: 1,
        parent_id: null,
        part_price: lot.partPrice,
        created_at: daysAgo(bought) + 'T10:00:00.000Z'
      });
      lot.parts.forEach(function (part, pi) {
        var soldAt = Math.max(2, bought - 10 - pi * 7);
        items.push({
          id: id++,
          owner_id: 0,
          platform: lot.platform,
          order_nr: 'DEMO-LOT-' + (li + 1) + '-' + (pi + 1),
          title: part[0],
          date: daysAgo(soldAt),
          sold_date: daysAgo(soldAt),
          buy_price: 0,
          sell_price: part[1],
          sell_platform: lot.platform,
          status: 'Verkauft',
          tracking: null,
          image: null,
          owned: 0,
          is_lot: 0,
          parent_id: lotId,
          part_price: null,
          created_at: daysAgo(soldAt) + 'T10:00:00.000Z'
        });
      });
    });

    var expenses = EXPENSES.map(function (e, i) {
      return { id: i + 1, owner_id: 0, date: daysAgo(e[0]), category: e[1], note: e[2], amount: e[3], created_at: daysAgo(e[0]) + 'T10:00:00.000Z' };
    });

    return {
      items: items,
      expenses: expenses,
      nextId: id,
      nextExpenseId: expenses.length + 1,
      balance: 2500,
      goal: { title: 'Neues Setup', target: 2000, current: 1240, unit: 'eur' },
      privateMode: true
    };
  }

  /* ---- Store -------------------------------------------------------------- */
  var store = null;

  function load() {
    if (store) return store;
    try {
      var raw = sessionStorage.getItem(STORE_KEY);
      if (raw) { store = JSON.parse(raw); return store; }
    } catch (_) {}
    store = buildDataset();
    save();
    return store;
  }

  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (_) {}
  }

  /* ---- Mock-Router --------------------------------------------------------
   * Beantwortet alles, was die App im Demo-Modus anfragt. Unbekannte API-Pfade
   * werden bewusst mit 404 abgewiesen statt durchgereicht: lieber ein sichtbar
   * fehlendes Feature als ein Schreibzugriff auf echte Daten. */
  function json(body, status) {
    var text = JSON.stringify(body === undefined ? null : body);
    var code = status || 200;
    if (typeof Response === 'function') {
      return new Response(text, { status: code, headers: { 'Content-Type': 'application/json' } });
    }
    // Minimalantwort fuer Umgebungen ohne fetch-API (z. B. Testrunner)
    return {
      ok: code >= 200 && code < 300,
      status: code,
      headers: { get: function () { return 'application/json'; } },
      json: function () { return Promise.resolve(JSON.parse(text)); },
      text: function () { return Promise.resolve(text); }
    };
  }

  function itemFromBody(body, id) {
    return {
      id: id,
      owner_id: 0,
      platform: body.platform || 'eBay',
      order_nr: body.order_nr || '',
      title: body.title || null,
      date: body.date || daysAgo(0),
      sold_date: body.sold_date || null,
      buy_price: Number(body.buy_price) || 0,
      sell_price: body.sell_price != null ? Number(body.sell_price) : null,
      sell_platform: body.sell_platform || null,
      status: body.status || 'Gekauft',
      tracking: body.tracking || null,
      image: body.image || null,
      owned: body.owned ? 1 : 0,
      is_lot: body.is_lot ? 1 : 0,
      parent_id: body.parent_id != null ? body.parent_id : null,
      part_price: body.part_price != null ? Number(body.part_price) : null,
      created_at: new Date().toISOString()
    };
  }

  function route(url, options) {
    var s = load();
    var method = (options && options.method || 'GET').toUpperCase();
    var body = {};
    if (options && options.body) { try { body = JSON.parse(options.body); } catch (_) {} }
    var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

    if (path === '/auth/me') {
      return json({ id: 0, discord_id: '0', username: 'Demo Account', avatar: null });
    }
    if (path === '/auth/logout') { return json({ success: true }); }

    if (path === '/api/profile') {
      // admin:false — im Demo-Dashboard gibt es keine Developer Tools
      return json({ balance: s.balance, goal: s.goal, privateMode: s.privateMode, admin: false });
    }
    if (path === '/api/profile/balance') { s.balance = Number(body.balance) || 0; save(); return json({ balance: s.balance }); }
    if (path === '/api/profile/goal') {
      if (method === 'DELETE') { s.goal = null; save(); return json({ goal: null }); }
      s.goal = { title: body.title || 'Dein Ziel', target: Number(body.target), current: Number(body.current) || 0, unit: body.unit || 'eur' };
      save();
      return json({ goal: s.goal });
    }
    if (path === '/api/profile/private') { s.privateMode = !!body.privateMode; save(); return json({ privateMode: s.privateMode }); }

    if (path === '/api/items') {
      if (method === 'GET') return json(s.items.slice().sort(function (a, b) { return b.created_at < a.created_at ? -1 : 1; }));
      if (method === 'POST') {
        var created = itemFromBody(body, s.nextId++);
        s.items.push(created); save();
        return json(created, 201);
      }
    }
    var itemMatch = path.match(/^\/api\/items\/(\d+)$/);
    if (itemMatch) {
      var id = parseInt(itemMatch[1], 10);
      var idx = s.items.findIndex(function (i) { return i.id === id; });
      if (idx === -1) return json({ error: 'Not found' }, 404);
      if (method === 'PUT') {
        var updated = itemFromBody(body, id);
        updated.created_at = s.items[idx].created_at;
        s.items[idx] = updated; save();
        return json(updated);
      }
      if (method === 'DELETE') {
        // Ein Lot nimmt seine Teil-Verkaeufe mit, wie im echten Backend
        s.items = s.items.filter(function (i) { return i.id !== id && i.parent_id !== id; });
        save();
        return json({ success: true });
      }
    }
    if (path === '/api/items/export') return json(s.items);
    if (path === '/api/items/import') return json({ imported: 0, skipped: 0, note: 'Im Demo-Modus deaktiviert' });

    if (path === '/api/expenses') {
      if (method === 'GET') return json(s.expenses.slice());
      if (method === 'POST') {
        var exp = { id: s.nextExpenseId++, owner_id: 0, date: body.date || daysAgo(0), amount: Number(body.amount) || 0, category: body.category || 'Sonstiges', note: body.note || null, created_at: new Date().toISOString() };
        s.expenses.push(exp); save();
        return json(exp, 201);
      }
    }
    var expMatch = path.match(/^\/api\/expenses\/(\d+)$/);
    if (expMatch) {
      var eid = parseInt(expMatch[1], 10);
      var eidx = s.expenses.findIndex(function (e) { return e.id === eid; });
      if (eidx === -1) return json({ error: 'Not found' }, 404);
      if (method === 'PUT') {
        s.expenses[eidx] = { id: eid, owner_id: 0, date: body.date, amount: Number(body.amount) || 0, category: body.category, note: body.note || null, created_at: s.expenses[eidx].created_at };
        save();
        return json(s.expenses[eidx]);
      }
      if (method === 'DELETE') { s.expenses.splice(eidx, 1); save(); return json({ success: true }); }
    }

    // Teilen und Admin-Funktionen gibt es in der Demo nicht
    if (path.indexOf('/api/share') === 0) return json({ error: 'Im Demo-Modus nicht verfuegbar' }, 403);
    if (path === '/api/discord/me') return json({ admin: false });
    if (path.indexOf('/api/discord') === 0) return json({ error: 'Im Demo-Modus nicht verfuegbar' }, 403);

    return json({ error: 'Im Demo-Modus nicht verfuegbar' }, 404);
  }

  /* ---- Installation ------------------------------------------------------- */
  var realFetch = null;

  function isApiCall(url) {
    return /^(https?:\/\/[^/]+)?\/(api|auth)\//.test(url);
  }

  function patchFetch() {
    if (realFetch) return;
    realFetch = global.fetch.bind(global);
    global.fetch = function (input, options) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isApiCall(url)) {
        var opts = options || (typeof input === 'object' ? input : {});
        return Promise.resolve(route(url, opts));
      }
      return realFetch(input, options);
    };
  }

  function banner() {
    if (document.getElementById('demo-banner')) return;
    var style = document.createElement('style');
    style.textContent = [
      '#demo-banner{position:fixed;top:0;left:0;right:0;height:38px;z-index:9999;background:#ff453a;color:#fff;',
      'display:flex;align-items:center;justify-content:center;gap:14px;font-size:13px;font-weight:800;letter-spacing:.02em;',
      'box-shadow:0 2px 12px rgba(0,0,0,.35);}',
      '#demo-banner button{background:rgba(0,0,0,.24);color:#fff;border:1px solid rgba(255,255,255,.45);border-radius:100px;',
      'padding:5px 14px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;}',
      '#demo-banner button:hover{background:rgba(0,0,0,.4);}',
      'body.demo-mode{padding-top:38px;}',
      'body.demo-mode .sidebar{top:38px;height:calc(100vh - 38px);}',
      'body.demo-mode .mobile-header{top:38px;}',
      '@media (max-width:640px){#demo-banner{font-size:12px;gap:10px;}}'
    ].join('');
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'demo-banner';
    bar.innerHTML = '<span>DEMO MODE — Platzhalterdaten, keine echten Verkaeufe</span>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Demo verlassen';
    btn.addEventListener('click', leave);
    bar.appendChild(btn);
    document.body.appendChild(bar);
    document.body.classList.add('demo-mode');
  }

  function isOn() {
    try { return sessionStorage.getItem(FLAG_KEY) === '1'; } catch (_) { return false; }
  }

  /* Wird beim Laden aufgerufen, bevor die App Daten holt. */
  function install() {
    if (!isOn()) return false;
    patchFetch();
    if (document.body) banner();
    else document.addEventListener('DOMContentLoaded', banner);
    return true;
  }

  function enter() {
    try { sessionStorage.setItem(FLAG_KEY, '1'); sessionStorage.removeItem(STORE_KEY); } catch (_) {}
    global.location.reload();
  }

  function leave() {
    try { sessionStorage.removeItem(FLAG_KEY); sessionStorage.removeItem(STORE_KEY); } catch (_) {}
    store = null;
    global.location.reload();
  }

  global.Demo = { install: install, enter: enter, leave: leave, isOn: isOn, _buildDataset: buildDataset };
})(window);
