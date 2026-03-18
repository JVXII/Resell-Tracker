const express = require('express');
const request = require('supertest');
const session = require('express-session');
const { requireAuth, requireViewMember } = require('../middleware/auth');
const { DatabaseSync } = require('node:sqlite');
const { applySchema } = require('../db');

function makeApp(db) {
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { req.db = db; next(); });

  app.get('/protected', requireAuth, (req, res) => res.json({ userId: req.userId }));
  return app;
}

test('requireAuth returns 401 when not logged in', async () => {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  const app = makeApp(db);
  const res = await request(app).get('/protected');
  expect(res.status).toBe(401);
});

test('requireAuth passes when session has userId', async () => {
  const db = new DatabaseSync(':memory:');
  applySchema(db);
  const app = makeApp(db);

  app.get('/login-test', (req, res) => {
    req.session.userId = 1;
    res.sendStatus(200);
  });

  const agent = request.agent(app);
  await agent.get('/login-test');
  const res = await agent.get('/protected');
  expect(res.status).toBe(200);
  expect(res.body.userId).toBe(1);
});