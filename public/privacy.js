/* =============================================================================
 * Privacy-Modus — verbirgt Finanzwerte, Stueckzahlen und Charts auf Knopfdruck.
 *
 * Idee: kein plumpes "••••", sondern der Wert zerfaellt zeichenweise in fremde
 * Glyphen und faellt beim Aufdecken genauso wieder zusammen. Jeder Wert bekommt
 * dabei sein eigenes, stabiles Maskenbild — gleiche Zahl heisst nicht gleiche
 * Maske, und ein Re-Render wuerfelt sie nicht neu.
 *
 * Das Modul haengt an keinem Dashboard-Teil: es arbeitet ueber Scopes und
 * Textknoten, ein MutationObserver faengt alles ein, was nachtraeglich
 * gerendert wird. Oeffentliche API: Privacy.init/toggle/isOn/refresh.
 * ========================================================================== */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'resell.privacy';

  /* Bereiche, in denen maskiert wird. Modals/Formulare bleiben absichtlich
   * unangetastet — wer gerade etwas eintraegt, will seine Eingabe sehen. */
  var SCOPES = ['#overview', '#charts', '#finance'];

  /* Alles, worin Zahlen keine Kennzahl sind (Datum, Bedienelemente, Seitenzahlen). */
  var SKIP_CLOSEST = 'button,input,textarea,select,svg,.action-bar,.filter-pills,' +
    '.sort-dropdown,.pagination,.page-btn,.item-meta,.part-meta,.col-date,.badge,' +
    '.tag-lot,.tag-owned,.lbl-preset,.period-btn,.pill';

  /* Ein Wert-Vorkommen: Betrag, Prozent, Stueckzahl oder ein einzelnes Eurozeichen. */
  var VALUE_RE = /[+\-−]?\s?\d[\d.,]*\s?(?:€|%)?|€/g;
  var DATE_RE = /^\d{1,2}\.\d{1,2}\.\d{2,4}$/;

  /* ---- Glyph-Pool ---------------------------------------------------------
   * Basis sind Zeichen, die jeder Font sicher hat. Statt exotisches Unicode zu
   * riskieren, entsteht das "Verdrehte" ueber CSS-Transformationen: eine
   * rotierte 7 oder ein gespiegeltes S liest sich als fremde Glyphe, wird aber
   * garantiert dargestellt. Ein paar Unicode-Kandidaten kommen nur dazu, wenn
   * der Font sie wirklich kennt (Breitenmessung gegen ein Fallback-Zeichen). */
  var BASE_GLYPHS = '0123456789AEFGJLNPRSXZ'.split('');
  var UNICODE_CANDIDATES = ['Ƨ', 'Ɛ', 'ᘔ', 'ᗺ', 'Ʌ', 'Ƽ', 'Ԑ', 'Ϟ'];
  var TRANSFORMS = ['', '', '', 'pv-rot', 'pv-flip', 'pv-rot'];

  var glyphs = null;

  function supportedGlyphs() {
    if (glyphs) return glyphs;
    glyphs = BASE_GLYPHS.slice();
    try {
      var c = document.createElement('canvas').getContext('2d');
      c.font = '16px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif');
      var missing = c.measureText('￾').width;
      UNICODE_CANDIDATES.forEach(function (g) {
        var w = c.measureText(g).width;
        if (w > 0 && Math.abs(w - missing) > 0.5) glyphs.push(g);
      });
    } catch (_) { /* ohne Canvas bleibt es beim sicheren Basis-Pool */ }
    return glyphs;
  }

  /* ---- Deterministischer Zufall ------------------------------------------
   * Gleicher Seed => gleiche Maske. So bleibt ein maskierter Wert ueber
   * Re-Renders hinweg identisch, unterscheidet sich aber von jedem anderen. */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* Maske gleicher Zeichenlaenge — das haelt das Layout ruhig. Trenner wandern
   * mit in den Pool, damit nicht Komma und Punkt die Struktur der echten Zahl
   * verraten. */
  function buildMask(real, seed) {
    var rand = rng(seed), pool = supportedGlyphs(), out = [];
    for (var i = 0; i < real.length; i++) {
      if (real[i] === ' ') { out.push({ c: ' ', t: '' }); continue; }
      out.push({
        c: pool[Math.floor(rand() * pool.length)],
        t: TRANSFORMS[Math.floor(rand() * TRANSFORMS.length)]
      });
    }
    return out;
  }

  /* ---- DOM: Werte einpacken ---------------------------------------------- */
  var applying = false;
  var valueCounter = 0;

  function wrapValues(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !/\d|€/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        var p = node.parentElement;
        if (!p || p.closest('.pv-val') || p.closest(SKIP_CLOSEST)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(function (node) {
      var text = node.nodeValue, matches = [], m;
      VALUE_RE.lastIndex = 0;
      while ((m = VALUE_RE.exec(text))) {
        if (DATE_RE.test(m[0].trim())) continue;
        matches.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      }
      if (!matches.length) return;

      var frag = document.createDocumentFragment(), cursor = 0;
      matches.forEach(function (match) {
        if (match.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, match.start)));

        // Breite messen, solange der echte Text noch im Fluss steht
        var width = 0;
        try {
          var range = document.createRange();
          range.setStart(node, match.start); range.setEnd(node, match.end);
          width = range.getBoundingClientRect().width;
        } catch (_) {}

        frag.appendChild(makeValue(match.text, width));
        cursor = match.end;
      });
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  function makeValue(real, width) {
    var span = document.createElement('span');
    span.className = 'pv-val';
    span.dataset.pvReal = real;
    if (width > 0) span.style.width = width.toFixed(2) + 'px';
    span._pvMask = buildMask(real, hash(real + '#' + (valueCounter++)));

    for (var i = 0; i < real.length; i++) {
      var ch = document.createElement('span');
      ch.className = 'pv-ch';
      ch.textContent = real[i];
      span.appendChild(ch);
    }
    return span;
  }

  /* ---- Scramble-Animation -------------------------------------------------
   * Ein einziger rAF-Ticker treibt alle Zeichen. Jedes hat eigenen Start und
   * eigene Dauer, dadurch zerfaellt der Wert organisch statt im Gleichschritt. */
  var active = [], ticking = false, lastRoll = 0;

  function settle(job) {
    job.el.textContent = job.char;
    job.el.className = 'pv-ch' + (job.transform ? ' ' + job.transform : '');
  }

  function tick(now) {
    var roll = now - lastRoll > 45;
    if (roll) lastRoll = now;
    var pool = supportedGlyphs(), remaining = [];

    for (var i = 0; i < active.length; i++) {
      var job = active[i];
      if (!job.el.isConnected) continue;
      if (now < job.t0) { remaining.push(job); continue; }
      if (now >= job.t1) { settle(job); continue; }
      if (roll) {
        job.el.textContent = pool[Math.floor(Math.random() * pool.length)];
        job.el.className = 'pv-ch pv-scramble ' + TRANSFORMS[Math.floor(Math.random() * TRANSFORMS.length)];
      }
      remaining.push(job);
    }
    active = remaining;
    if (active.length) requestAnimationFrame(tick); else ticking = false;
  }

  function animate(span, toMask) {
    var chars = span.children, real = span.dataset.pvReal || '';
    var mask = span._pvMask || (span._pvMask = buildMask(real, hash(real + '#' + (valueCounter++))));
    var now = performance.now();
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    for (var i = 0; i < chars.length; i++) {
      var job = toMask
        ? { el: chars[i], char: mask[i] ? mask[i].c : '?', transform: mask[i] ? mask[i].t : '' }
        : { el: chars[i], char: real[i] || '', transform: '' };

      if (reduce) { settle(job); continue; }
      // Leichter Versatz pro Stelle + unterschiedliche Dauer => organischer Zerfall
      job.t0 = now + i * 26 + Math.random() * 110;
      job.t1 = job.t0 + 200 + Math.random() * 320;
      active.push(job);
    }
    if (active.length && !ticking) { ticking = true; requestAnimationFrame(tick); }
  }

  /* Sofort maskieren, ohne Animation — fuer Werte, die waehrend des aktiven
   * Privacy-Modus nachgerendert werden. Laeuft vor dem naechsten Paint, es
   * blitzt also nichts auf. */
  function maskInstantly(span) {
    var mask = span._pvMask, chars = span.children;
    for (var i = 0; i < chars.length; i++) {
      chars[i].textContent = mask[i] ? mask[i].c : '?';
      chars[i].className = 'pv-ch' + (mask[i] && mask[i].t ? ' ' + mask[i].t : '');
    }
  }

  function eachScope(fn) {
    SCOPES.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) fn(el);
    });
  }

  function allValues() {
    var out = [];
    eachScope(function (root) {
      out = out.concat(Array.prototype.slice.call(root.querySelectorAll('.pv-val')));
    });
    return out;
  }

  /* ---- Zustand ------------------------------------------------------------ */
  var on = false;

  function refresh() {
    if (!on) return;
    applying = true;
    eachScope(function (root) {
      wrapValues(root);
      root.querySelectorAll('.pv-val').forEach(function (span) {
        if (span.dataset.pvMasked !== '1') { maskInstantly(span); span.dataset.pvMasked = '1'; }
      });
    });
    applying = false;
  }

  function unwrap() {
    allValues().forEach(function (span) {
      span.parentNode.replaceChild(document.createTextNode(span.dataset.pvReal || ''), span);
    });
    eachScope(function (root) { root.normalize(); });
  }

  function setState(next, animated) {
    on = next;
    document.body.classList.toggle('privacy-on', on);
    document.querySelectorAll('.privacy-btn').forEach(function (b) {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Werte wieder anzeigen' : 'Werte verbergen';
    });
    try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch (_) {}

    if (on) {
      applying = true;
      eachScope(wrapValues);
      applying = false;
      var vals = allValues();
      vals.forEach(function (s) { s.dataset.pvMasked = '1'; });
      if (animated) vals.forEach(function (s) { animate(s, true); });
      else vals.forEach(maskInstantly);
      return;
    }

    if (!animated) { unwrap(); return; }
    allValues().forEach(function (s) { animate(s, false); });
    // Erst nach der Reveal-Animation die Spans wieder aufloesen
    setTimeout(function () { if (!on) unwrap(); }, 950);
  }

  function toggle() { setState(!on, true); }
  function isOn() { return on; }

  /* ---- Init --------------------------------------------------------------- */
  function injectStyles() {
    var css = [
      '.pv-val{display:inline-block;text-align:inherit;font-variant-numeric:tabular-nums;white-space:nowrap;vertical-align:baseline;}',
      '.pv-ch{display:inline-block;transition:opacity .12s linear;}',
      '.pv-ch.pv-rot{transform:rotate(180deg);}',
      '.pv-ch.pv-flip{transform:scaleX(-1);}',
      '.pv-ch.pv-scramble{opacity:.72;}',
      /* Charts verraten ohne Zahlen immer noch die Groessenordnung */
      'body.privacy-on #overview canvas,body.privacy-on #charts canvas,body.privacy-on #finance canvas,'+
      'body.privacy-on .ov-chart,body.privacy-on .spark{filter:blur(9px);pointer-events:none;}',
      '.privacy-btn .pv-slash{stroke-dasharray:26;stroke-dashoffset:26;transition:stroke-dashoffset .3s cubic-bezier(.4,0,.2,1);}',
      '.privacy-btn.on .pv-slash{stroke-dashoffset:0;}',
      '.privacy-btn .pv-eye{transition:transform .3s cubic-bezier(.4,0,.2,1);transform-origin:12px 12px;}',
      '.privacy-btn.on .pv-eye{transform:scaleY(.62);}',
      '.privacy-btn .pv-iris{transition:transform .3s cubic-bezier(.4,0,.2,1);transform-origin:12px 12px;}',
      '.privacy-btn.on .pv-iris{transform:scale(.3);}',
      '@media (prefers-reduced-motion: reduce){.privacy-btn *{transition:none!important;}}'
    ].join('\n');
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function observe() {
    var observer = new MutationObserver(function () {
      if (applying || !on) return;
      refresh();
    });
    eachScope(function (root) {
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    });
  }

  function init() {
    injectStyles();
    observe();
    var saved = '0';
    try { saved = localStorage.getItem(STORAGE_KEY) || '0'; } catch (_) {}
    setState(saved === '1', false);
  }

  global.Privacy = { init: init, toggle: toggle, isOn: isOn, refresh: refresh };
})(window);
