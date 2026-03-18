require('dotenv').config();
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function applySchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      platform TEXT NOT NULL,
      order_nr TEXT NOT NULL,
      date TEXT NOT NULL,
      buy_price REAL NOT NULL DEFAULT 0,
      sell_price REAL,
      status TEXT NOT NULL CHECK(status IN ('Gekauft','Lager','Verkauft')),
      tracking TEXT,
      image TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shared_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
      invite_token TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS view_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      view_id INTEGER NOT NULL REFERENCES shared_views(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK(role IN ('read','edit')),
      UNIQUE(view_id, user_id)
    );
  `);
}

let db;

if (process.env.NODE_ENV !== 'test') {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
  db = new DatabaseSync(path.join(dataDir, 'resell.db'));
  applySchema(db);
}

module.exports = { applySchema, get db() { return db; } };