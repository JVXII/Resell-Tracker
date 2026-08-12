const express = require('express');
const request = require('supertest');
const session = require('express-session');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { createTestDb, insertUser } = require('./helpers');

const ADMIN_ID = 'der-admin';

// Jeder Test setzt sich seine Umgebung selbst; danach wird zurueckgesetzt,
// damit die Tests unabhaengig von ihrer Reihenfolge laufen.
const ENV_KEYS = ['ADMIN_DISCORD_ID', 'DEALBOT_API_URL', 'DEALBOT_API_KEY'];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  delete global.fetch;
});

function makeApp(db, mount) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { req.db = db; next(); });
  app.post('/test-login', (req, res) => { req.session.userId = req.body.userId; res.sendStatus(200); });
  mount(app);
  return app;
}

function makeGateApp(db) {
  return makeApp(db, (app) => {
    app.get('/admin-only', requireAuth, requireAdmin, (req, res) => res.json({ ok: true }));
  });
}

async function loginAs(app, userId) {
  const agent = request.agent(app);
  await agent.post('/test-login').send({ userId });
  return agent;
}

describe('requireAdmin', () => {
  test('gibt 401 wenn nicht eingeloggt', async () => {
    process.env.ADMIN_DISCORD_ID = ADMIN_ID;
    const res = await request(makeGateApp(createTestDb())).get('/admin-only');
    expect(res.status).toBe(401);
  });

  test('gibt 403 fuer Nicht-Admins', async () => {
    const db = createTestDb();
    const user = insertUser(db, { discord_id: 'nicht-der-admin' });
    process.env.ADMIN_DISCORD_ID = ADMIN_ID;

    const agent = await loginAs(makeGateApp(db), user.id);
    const res = await agent.get('/admin-only');
    expect(res.status).toBe(403);
  });

  test('laesst den Admin durch', async () => {
    const db = createTestDb();
    const user = insertUser(db, { discord_id: ADMIN_ID });
    process.env.ADMIN_DISCORD_ID = ADMIN_ID;

    const agent = await loginAs(makeGateApp(db), user.id);
    const res = await agent.get('/admin-only');
    expect(res.status).toBe(200);
  });

  test('sperrt alle, wenn ADMIN_DISCORD_ID fehlt', async () => {
    const db = createTestDb();
    const user = insertUser(db, { discord_id: 'irgendwer' });
    delete process.env.ADMIN_DISCORD_ID;

    const agent = await loginAs(makeGateApp(db), user.id);
    const res = await agent.get('/admin-only');
    expect(res.status).toBe(403);
  });
});
