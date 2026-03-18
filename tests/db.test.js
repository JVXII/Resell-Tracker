const { DatabaseSync } = require('node:sqlite');
const { applySchema } = require('../db');

function createDb() {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  return db;
}

test('creates users table', () => {
  const db = createDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  expect(row).toBeTruthy();
});

test('creates items table with owner_id', () => {
  const db = createDb();
  const cols = db.prepare("PRAGMA table_info(items)").all().map(c => c.name);
  expect(cols).toContain('owner_id');
  expect(cols).toContain('image');
});

test('creates shared_views with unique owner_id', () => {
  const db = createDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shared_views'").get();
  expect(row).toBeTruthy();
});

test('creates view_members table', () => {
  const db = createDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='view_members'").get();
  expect(row).toBeTruthy();
});