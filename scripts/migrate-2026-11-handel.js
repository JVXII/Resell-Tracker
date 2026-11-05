/* Einmalige Datenumstellung fuer Handel, Stueckkosten und den Roccat-Verlust.
   Spec: docs/superpowers/specs/2026-11-05-handel-und-lot-kosten-design.md

   Aufruf: node scripts/migrate-2026-11-handel.js <db-pfad> [--apply]
   Ohne --apply wird nur geprueft und das Ergebnis berechnet, nichts geschrieben.
   Mit --apply entsteht vorher ein Backup neben der Datenbank. */
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { applyMigrations } = require('../db');
const Calc = require('../public/calc.js');

const [dbPath, flag] = process.argv.slice(2);
const apply = flag === '--apply';
const OWNER_ID = 1;
const LOSS_DATE = '2026-11-05';

const EXPECTED = [
  { id: 38, title: 'Monster Plüsch Weiß', buy_price: 35.31 },
  { id: 39, title: 'Game Totem of Undying Cosplay Schlüsselanhänger', buy_price: 52.57 },
  { id: 61, title: 'Monster Plushi', buy_price: 36.59 },
  { id: 19, title: 'Roccat Tasten', buy_price: 10 },
];

function fail(message) { console.error('ABBRUCH: ' + message); process.exit(1); }

if (!dbPath || !fs.existsSync(dbPath)) fail('Datenbank nicht gefunden: ' + dbPath);
const db = new DatabaseSync(dbPath);
applyMigrations(db);

for (const e of EXPECTED) {
  const row = db.prepare('SELECT * FROM items WHERE id = ? AND owner_id = ?').get(e.id, OWNER_ID);
  if (!row || row.title !== e.title || row.buy_price !== e.buy_price || !row.is_lot) fail(`Eintrag ${e.id} passt nicht zur Erwartung`);
}
const roccatParts = db.prepare('SELECT count(*) AS n FROM items WHERE parent_id = 19').get().n;
if (roccatParts) fail('Roccat Tasten hat Teil-Verkaeufe');

const summary = () => {
  const items = db.prepare('SELECT * FROM items WHERE owner_id = ?').all(OWNER_ID);
  const t = Calc.totals(items);
  return { profit: +t.profit.toFixed(2), stockValue: +t.stockValue.toFixed(2), spent: +t.spent.toFixed(2), received: +t.received.toFixed(2) };
};

if (apply) {
  const backup = `${dbPath}.vor-handel-${Date.now()}.bak`;
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log('Backup: ' + backup);
}

const before = summary();
db.exec('BEGIN');
try {
  const lot = db.prepare(`UPDATE items SET segment = 'handel', lot_qty = ?, part_price = COALESCE(?, part_price), part_shipping = ? WHERE id = ?`);
  lot.run(5, null, null, 38);
  lot.run(19, null, null, 39);
  lot.run(7, 17.99, 4.19, 61);
  // Bleibt als Artikel bestehen: Geloescht verschwaenden auch die 10 € Verlust.
  db.prepare(`UPDATE items SET title = 'Roccat Tastatur', is_lot = 0, part_price = NULL, status = 'Verkauft', sell_price = 0, sold_date = ? WHERE id = 19`).run(LOSS_DATE);
  const after = summary();
  console.log('Vorher (neue Rechnung):', before);
  console.log('Nachher:', after);
  db.exec(apply ? 'COMMIT' : 'ROLLBACK');
  console.log(apply ? 'Umstellung gespeichert.' : 'Trockenlauf: nichts gespeichert.');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
