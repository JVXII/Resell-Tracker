const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const { applySchema } = require('../db');

function createTestDb() {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  return db;
}

function createTestApp(db, routes) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { req.db = db; next(); });

  // Test-only login shortcut — never add to production server
  app.post('/test-login', (req, res) => {
    req.session.userId = req.body.userId;
    res.sendStatus(200);
  });

  for (const [path, router] of Object.entries(routes)) {
    app.use(path, router);
  }
  return app;
}

function insertUser(db, overrides = {}) {
  const user = {
    discord_id: overrides.discord_id || 'discord_' + Math.random(),
    username: overrides.username || 'testuser',
    avatar: overrides.avatar || null,
  };
  const result = db.prepare('INSERT INTO users (discord_id, username, avatar) VALUES (?,?,?)').run(user.discord_id, user.username, user.avatar);
  return { id: result.lastInsertRowid, ...user };
}

module.exports = { createTestDb, createTestApp, insertUser };