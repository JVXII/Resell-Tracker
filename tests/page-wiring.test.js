const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// Das Inline-Script ruft am Ende init() auf, und init() ruft Demo.install() sowie
// Privacy.init() auf. Werden die Module erst danach geladen, existieren window.Demo
// und window.Privacy zu diesem Zeitpunkt nicht — die Aufrufe laufen still ins Leere
// und der Demo-Modus oeffnet stattdessen das echte Dashboard.
const inlineStart = HTML.indexOf('\n<script>');

function srcPos(file) {
  const pos = HTML.indexOf('src="/' + file + '"');
  expect(pos).toBeGreaterThan(-1);
  return pos;
}

test('das Inline-Script ist auffindbar', () => {
  expect(inlineStart).toBeGreaterThan(-1);
});

test('demo.js wird vor dem Inline-Script geladen', () => {
  expect(srcPos('demo.js')).toBeLessThan(inlineStart);
});

test('privacy.js wird vor dem Inline-Script geladen', () => {
  expect(srcPos('privacy.js')).toBeLessThan(inlineStart);
});

test('init() schaltet den Demo-Modus vor dem ersten Datenabruf scharf', () => {
  const init = HTML.slice(HTML.indexOf('async function init(){'));
  const body = init.slice(0, init.indexOf('\n}'));
  expect(body.indexOf('Demo.install()')).toBeGreaterThan(-1);
  expect(body.indexOf('Demo.install()')).toBeLessThan(body.indexOf("fetch('/auth/me')"));
});
