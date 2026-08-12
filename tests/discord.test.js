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

function makeProxyApp(db) {
  return makeApp(db, (app) => { app.use('/api/discord', require('../routes/discord')); });
}

/** Loggt als Admin ein und stellt die Bot-Verbindung auf einen Dummy-Endpunkt. */
async function adminProxyAgent(db) {
  const user = insertUser(db, { discord_id: ADMIN_ID });
  process.env.ADMIN_DISCORD_ID = ADMIN_ID;
  process.env.DEALBOT_API_URL = 'http://127.0.0.1:9999';
  process.env.DEALBOT_API_KEY = 'geheimer-key';
  return loginAs(makeProxyApp(db), user.id);
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

describe('/api/discord Proxy', () => {
  test('GET /me meldet admin:false fuer normale Nutzer', async () => {
    const db = createTestDb();
    const user = insertUser(db, { discord_id: 'irgendwer' });
    process.env.ADMIN_DISCORD_ID = ADMIN_ID;

    const agent = await loginAs(makeProxyApp(db), user.id);
    const res = await agent.get('/api/discord/me');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ admin: false });
  });

  test('GET /me meldet admin:true fuer den Admin', async () => {
    const agent = await adminProxyAgent(createTestDb());
    const res = await agent.get('/api/discord/me');
    expect(res.body).toEqual({ admin: true });
  });

  test('GET /me braucht einen Login', async () => {
    process.env.ADMIN_DISCORD_ID = ADMIN_ID;
    const res = await request(makeProxyApp(createTestDb())).get('/api/discord/me');
    expect(res.status).toBe(401);
  });

  test('GET /searches reicht an den Bot weiter und setzt den Key', async () => {
    const agent = await adminProxyAgent(createTestDb());
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => [{ id: 1, name: 'Xbox' }] }));

    const res = await agent.get('/api/discord/searches');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, name: 'Xbox' }]);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9999/searches');
    expect(init.headers['x-api-key']).toBe('geheimer-key');
  });

  test('der API-Key taucht nie in der Antwort an den Browser auf', async () => {
    const agent = await adminProxyAgent(createTestDb());
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));

    const res = await agent.get('/api/discord/searches');

    expect(JSON.stringify(res.body)).not.toContain('geheimer-key');
    expect(JSON.stringify(res.headers)).not.toContain('geheimer-key');
  });

  test('POST /searches reicht den Body weiter und gibt den Status durch', async () => {
    const agent = await adminProxyAgent(createTestDb());
    global.fetch = jest.fn(async () => ({ status: 201, json: async () => ({ id: 5 }) }));

    const res = await agent.post('/api/discord/searches').send({ name: 'Kamera' });

    expect(res.status).toBe(201);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9999/searches');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'Kamera' });
  });

  test('Bot nicht erreichbar gibt 502 statt abzustuerzen', async () => {
    const agent = await adminProxyAgent(createTestDb());
    global.fetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); });

    const res = await agent.get('/api/discord/searches');

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/nicht erreichbar/i);
  });

  test('Nicht-Admin kommt nicht an den Proxy', async () => {
    const db = createTestDb();
    const user = insertUser(db, { discord_id: 'irgendwer' });
    process.env.ADMIN_DISCORD_ID = ADMIN_ID;
    global.fetch = jest.fn();

    const agent = await loginAs(makeProxyApp(db), user.id);
    const res = await agent.get('/api/discord/searches');

    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('nicht erlaubte Pfade werden nicht weitergereicht', async () => {
    const agent = await adminProxyAgent(createTestDb());
    global.fetch = jest.fn();

    const res = await agent.get('/api/discord/logs');

    expect(res.status).toBe(404);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('erlaubte Aktions-Pfade kommen durch', async () => {
    const agent = await adminProxyAgent(createTestDb());
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ ok: true }) }));

    const res = await agent.post('/api/discord/searches/3/pause');

    expect(res.status).toBe(200);
    expect(global.fetch.mock.calls[0][0]).toBe('http://127.0.0.1:9999/searches/3/pause');
  });
});
