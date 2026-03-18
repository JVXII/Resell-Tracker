# Webserver Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the static HTML/localStorage app to a Node.js + Express server with SQLite persistence, Discord OAuth, multi-user support, and shared views.

**Architecture:** Express serves the existing frontend as static files while new API routes replace all localStorage calls. SQLite stores users, items, and sharing state. Discord OAuth handles all authentication — no passwords.

**Tech Stack:** Node.js, Express, better-sqlite3, express-session, connect-sqlite3, uuid, Jest, Supertest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Create | Dependencies, scripts |
| `.env.example` | Create | Required env var documentation |
| `.gitignore` | Modify | Add `data/`, `.env`, `node_modules/` |
| `server.js` | Create | Express app, middleware, route wiring, static serving |
| `db.js` | Create | SQLite init, schema creation, exports `db` instance |
| `middleware/auth.js` | Create | `requireAuth`, `requireViewMember` middleware |
| `routes/auth.js` | Create | Discord OAuth2 flow + `/auth/me` |
| `routes/items.js` | Create | Items CRUD + import/export |
| `routes/share.js` | Create | Invite (GET current / POST rotate), join, member management |
| `routes/shared.js` | Create | `GET /:ownerId/items` — read-only shared view endpoint |
| `public/login.html` | Create | Discord login button page |
| `public/index.html` | Modify | localStorage → fetch(), add auth UI + share UI |
| `tests/helpers.js` | Create | In-memory DB factory, test app factory, session helpers |
| `tests/db.test.js` | Create | Schema smoke tests |
| `tests/items.test.js` | Create | Items API integration tests |
| `tests/share.test.js` | Create | Share API integration tests |
| `tests/auth.test.js` | Create | Auth middleware tests |

---

## Task 1: Project Setup

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1.1: Create package.json**

```json
{
  "name": "resell-tracker",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "connect-sqlite3": "^0.9.13",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-session": "^1.18.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 1.2: Create .env.example**

```
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_REDIRECT_URI=http://localhost:3000/auth/discord/callback
SESSION_SECRET=change_me_to_at_least_32_random_characters
PORT=3000
```

- [ ] **Step 1.3: Update .gitignore**

Add to `.gitignore`:
```
node_modules/
data/
.env
```

- [ ] **Step 1.4: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 1.5: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore
git commit -m "chore: add Node.js project setup"
```

---

## Task 2: Database Layer

**Files:**
- Create: `db.js`
- Create: `tests/db.test.js`

- [ ] **Step 2.1: Write failing schema test**

Create `tests/db.test.js`:
```js
const Database = require('better-sqlite3');
const { applySchema } = require('../db');

function createDb() {
  const db = new Database(':memory:');
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
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test -- tests/db.test.js
```

Expected: FAIL — `Cannot find module '../db'`

- [ ] **Step 2.3: Create db.js**

```js
require('dotenv').config();
const Database = require('better-sqlite3');
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
  db = new Database(path.join(dataDir, 'resell.db'));
  applySchema(db);
}

module.exports = { applySchema, get db() { return db; } };
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npm test -- tests/db.test.js
```

Expected: PASS (4 tests)

- [ ] **Step 2.5: Commit**

```bash
git add db.js tests/db.test.js
git commit -m "feat: add SQLite database schema"
```

---

## Task 3: Auth Middleware

**Files:**
- Create: `middleware/auth.js`
- Create: `tests/auth.test.js`

- [ ] **Step 3.1: Write failing middleware tests**

Create `tests/auth.test.js`:
```js
const express = require('express');
const request = require('supertest');
const session = require('express-session');
const { requireAuth, requireViewMember } = require('../middleware/auth');
const Database = require('better-sqlite3');
const { applySchema } = require('../db');

function makeApp(db) {
  const app = express();
  app.use(session({ secret: 'test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => { req.db = db; next(); });

  app.get('/protected', requireAuth, (req, res) => res.json({ userId: req.userId }));
  return app;
}

test('requireAuth returns 401 when not logged in', async () => {
  const db = new Database(':memory:');
  applySchema(db);
  const app = makeApp(db);
  const res = await request(app).get('/protected');
  expect(res.status).toBe(401);
});

test('requireAuth passes when session has userId', async () => {
  const db = new Database(':memory:');
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
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npm test -- tests/auth.test.js
```

Expected: FAIL — `Cannot find module '../middleware/auth'`

- [ ] **Step 3.3: Create middleware/auth.js**

```js
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  req.userId = req.session.userId;
  next();
}

/**
 * requireViewMember checks that the logged-in user is a member (or owner)
 * of the shared view identified by req.params.ownerId.
 * Sets req.viewRole = 'owner' | 'edit' | 'read' on success.
 * Must be chained after requireAuth.
 */
function requireViewMember(req, res, next) {
  const db = req.db;
  const ownerId = parseInt(req.params.ownerId, 10);

  if (req.userId === ownerId) {
    req.viewRole = 'owner';
    return next();
  }

  const member = db.prepare(`
    SELECT vm.role FROM view_members vm
    JOIN shared_views sv ON sv.id = vm.view_id
    WHERE sv.owner_id = ? AND vm.user_id = ?
  `).get(ownerId, req.userId);

  if (!member) return res.status(403).json({ error: 'Access denied' });
  req.viewRole = member.role;
  next();
}

module.exports = { requireAuth, requireViewMember };
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npm test -- tests/auth.test.js
```

Expected: PASS (2 tests)

- [ ] **Step 3.5: Commit**

```bash
git add middleware/auth.js tests/auth.test.js
git commit -m "feat: add auth middleware"
```

---

## Task 4: Items API

**Files:**
- Create: `routes/items.js`
- Create: `tests/helpers.js`
- Create: `tests/items.test.js`

- [ ] **Step 4.1: Create test helper**

Create `tests/helpers.js`:
```js
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const { applySchema } = require('../db');

function createTestDb() {
  const db = new Database(':memory:');
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
```

- [ ] **Step 4.2: Write failing items tests**

Create `tests/items.test.js`:
```js
const request = require('supertest');
const { createTestDb, createTestApp, insertUser } = require('./helpers');
const itemsRouter = require('../routes/items');

function makeApp(db) {
  return createTestApp(db, { '/api/items': itemsRouter });
}

let db, app, user;

beforeEach(() => {
  db = createTestDb();
  app = makeApp(db);
  user = insertUser(db);
});

async function login(agent, userId) {
  await agent.post('/test-login').send({ userId });
}

test('GET /api/items returns 401 when not logged in', async () => {
  const res = await request(app).get('/api/items');
  expect(res.status).toBe(401);
});

test('GET /api/items returns empty array for new user', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const res = await agent.get('/api/items');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('POST /api/items creates an item', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const res = await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'ORD-1', date: '2026-01-01',
    buy_price: 50, status: 'Lager'
  });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeTruthy();
});

test('POST /api/items rejects invalid status', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const res = await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'ORD-1', date: '2026-01-01',
    buy_price: 50, status: 'INVALID'
  });
  expect(res.status).toBe(400);
});

test('PUT /api/items/:id updates own item', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const createRes = await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'ORD-2', date: '2026-01-01',
    buy_price: 50, status: 'Lager'
  });
  const id = createRes.body.id;

  const res = await agent.put(`/api/items/${id}`).send({ status: 'Verkauft', sell_price: 80 });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('Verkauft');
});

test("PUT /api/items/:id cannot update another user's item", async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const createRes = await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'ORD-3', date: '2026-01-01',
    buy_price: 50, status: 'Lager'
  });
  const id = createRes.body.id;

  const other = insertUser(db, { discord_id: 'other_discord' });
  const agent2 = request.agent(app);
  await login(agent2, other.id);
  const res = await agent2.put(`/api/items/${id}`).send({ status: 'Verkauft' });
  expect(res.status).toBe(403);
});

test('DELETE /api/items/:id removes own item', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const createRes = await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'ORD-4', date: '2026-01-01',
    buy_price: 50, status: 'Lager'
  });
  const id = createRes.body.id;

  const res = await agent.delete(`/api/items/${id}`);
  expect(res.status).toBe(200);

  const list = await agent.get('/api/items');
  expect(list.body).toHaveLength(0);
});

test('POST /api/items/import imports from old JSON format', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  const backup = [
    { platform: 'eBay', order: 'IMP-1', date: '2025-01-01', buy: 30, sell: 60, status: 'Verkauft' },
    { platform: 'Kleinanzeigen', order: 'IMP-2', date: '2025-02-01', buy: 20, status: 'Lager' }
  ];
  const res = await agent.post('/api/items/import').send(backup);
  expect(res.status).toBe(200);
  expect(res.body.imported).toBe(2);

  const list = await agent.get('/api/items');
  expect(list.body).toHaveLength(2);
});

test('POST /api/items/import skips duplicate order_nr', async () => {
  const agent = request.agent(app);
  await login(agent, user.id);
  await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'DUP-1', date: '2026-01-01', buy_price: 10, status: 'Lager'
  });
  const res = await agent.post('/api/items/import').send([
    { platform: 'eBay', order: 'DUP-1', date: '2026-01-01', buy: 10, status: 'Lager' }
  ]);
  expect(res.status).toBe(200);
  expect(res.body.imported).toBe(0);
  expect(res.body.skipped).toBe(1);
});
```

- [ ] **Step 4.3: Run test to verify it fails**

```bash
npm test -- tests/items.test.js
```

Expected: FAIL — `Cannot find module '../routes/items'`

- [ ] **Step 4.4: Create routes/items.js**

> **Important:** `/import` and `/export` routes MUST be registered before the generic `/:id` routes, otherwise Express will treat `import` and `export` as IDs.

```js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const VALID_STATUSES = ['Gekauft', 'Lager', 'Verkauft'];

function validateItem(body) {
  const errors = [];
  if (!body.platform) errors.push('platform required');
  if (!body.order_nr) errors.push('order_nr required');
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.push('date must be YYYY-MM-DD');
  if (typeof body.buy_price !== 'number' || body.buy_price < 0) errors.push('buy_price must be a non-negative number');
  if (!VALID_STATUSES.includes(body.status)) errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  return errors;
}

router.use(requireAuth);

// GET /api/items — own items
router.get('/', (req, res) => {
  const items = req.db.prepare(
    'SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(req.userId);
  res.json(items);
});

// POST /api/items/import — MUST be before POST /
router.post('/import', (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected array' });

  let imported = 0, skipped = 0;

  const existsStmt = req.db.prepare('SELECT 1 FROM items WHERE owner_id = ? AND order_nr = ?');
  const insertStmt = req.db.prepare(`
    INSERT INTO items (owner_id, platform, order_nr, date, buy_price, sell_price, status, tracking, image)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);

  const insertMany = req.db.transaction((entries) => {
    for (const e of entries) {
      const orderNr = e.order || e.order_nr;
      if (!orderNr) { skipped++; continue; }
      if (existsStmt.get(req.userId, orderNr)) { skipped++; continue; }

      const status = VALID_STATUSES.includes(e.status) ? e.status : 'Lager';
      insertStmt.run(
        req.userId,
        e.platform || '',
        orderNr,
        e.date || new Date().toISOString().split('T')[0],
        typeof e.buy === 'number' ? e.buy : (e.buy_price ?? 0),
        typeof e.sell === 'number' ? e.sell : (e.sell_price ?? null),
        status,
        e.tracking || null,
        e.image || null
      );
      imported++;
    }
  });

  insertMany(entries);
  res.json({ imported, skipped });
});

// GET /api/items/export — MUST be before GET /:id
router.get('/export', (req, res) => {
  const items = req.db.prepare(
    'SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(req.userId);
  const exported = items.map(i => ({
    platform: i.platform,
    order: i.order_nr,
    date: i.date,
    buy: i.buy_price,
    sell: i.sell_price,
    status: i.status,
    tracking: i.tracking,
    image: i.image,
  }));
  res.setHeader('Content-Disposition', 'attachment; filename="resell-backup.json"');
  res.json(exported);
});

// POST /api/items
router.post('/', (req, res) => {
  const errors = validateItem(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const { platform, order_nr, date, buy_price, sell_price, status, tracking, image } = req.body;
  const result = req.db.prepare(`
    INSERT INTO items (owner_id, platform, order_nr, date, buy_price, sell_price, status, tracking, image)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(req.userId, platform, order_nr, date, buy_price, sell_price ?? null, status, tracking ?? null, image ?? null);

  const item = req.db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// PUT /api/items/:id
router.put('/:id', (req, res) => {
  const item = req.db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const isOwner = item.owner_id === req.userId;
  let canEdit = isOwner;

  if (!canEdit) {
    const member = req.db.prepare(`
      SELECT vm.role FROM view_members vm
      JOIN shared_views sv ON sv.id = vm.view_id
      WHERE sv.owner_id = ? AND vm.user_id = ?
    `).get(item.owner_id, req.userId);
    canEdit = member?.role === 'edit';
  }

  if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['platform', 'order_nr', 'date', 'buy_price', 'sell_price', 'status', 'tracking', 'image'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  req.db.prepare(`UPDATE items SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  const updated = req.db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/items/:id — owner only
router.delete('/:id', (req, res) => {
  const item = req.db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.owner_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  req.db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 4.5: Run test to verify it passes**

```bash
npm test -- tests/items.test.js
```

Expected: PASS (9 tests)

- [ ] **Step 4.6: Commit**

```bash
git add routes/items.js tests/items.test.js tests/helpers.js
git commit -m "feat: add items API with CRUD, import, and export"
```

---

## Task 5: Share API

**Files:**
- Create: `routes/share.js`
- Create: `routes/shared.js`
- Create: `tests/share.test.js`

- [ ] **Step 5.1: Write failing share tests**

Create `tests/share.test.js`:
```js
const request = require('supertest');
const { createTestDb, createTestApp, insertUser } = require('./helpers');
const shareRouter = require('../routes/share');
const sharedRouter = require('../routes/shared');
const itemsRouter = require('../routes/items');

function makeApp(db) {
  return createTestApp(db, {
    '/api/share': shareRouter,
    '/api/shared': sharedRouter,
    '/api/items': itemsRouter,
  });
}

let db, app, owner, other;

beforeEach(() => {
  db = createTestDb();
  app = makeApp(db);
  owner = insertUser(db, { discord_id: 'owner_discord', username: 'owner' });
  other = insertUser(db, { discord_id: 'other_discord', username: 'other' });
});

async function login(agent, userId) {
  await agent.post('/test-login').send({ userId });
}

test('GET /api/share/invite returns current token (creates if none)', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const res = await agent.get('/api/share/invite');
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
});

test('GET /api/share/invite returns same token on second call', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const first = await agent.get('/api/share/invite');
  const second = await agent.get('/api/share/invite');
  expect(first.body.token).toBe(second.body.token);
});

test('POST /api/share/invite rotates token without removing members', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);

  const first = await agent.get('/api/share/invite');
  const token = first.body.token;

  // Other user joins
  const agent2 = request.agent(app);
  await login(agent2, other.id);
  await agent2.get(`/api/share/join/${token}`);

  // Owner rotates token
  const second = await agent.post('/api/share/invite');
  expect(second.body.token).not.toBe(token);

  // Other user is still a member
  const members = await agent.get('/api/share/members');
  expect(members.body).toHaveLength(1);
});

test('GET /api/share/join/:token adds user as read member', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const { token } = (await agent.get('/api/share/invite')).body;

  const agent2 = request.agent(app);
  await login(agent2, other.id);
  const res = await agent2.get(`/api/share/join/${token}`);
  expect(res.status).toBe(200);

  const members = await agent.get('/api/share/members');
  expect(members.body[0].role).toBe('read');
});

test('GET /api/share/join/:token returns 404 for invalid token', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const res = await agent.get('/api/share/join/bad-token-xyz');
  expect(res.status).toBe(404);
});

test('PUT /api/share/members/:userId changes role', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const { token } = (await agent.get('/api/share/invite')).body;

  const agent2 = request.agent(app);
  await login(agent2, other.id);
  await agent2.get(`/api/share/join/${token}`);

  const res = await agent.put(`/api/share/members/${other.id}`).send({ role: 'edit' });
  expect(res.status).toBe(200);

  const members = await agent.get('/api/share/members');
  expect(members.body[0].role).toBe('edit');
});

test('DELETE /api/share/members/:userId owner removes member', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const { token } = (await agent.get('/api/share/invite')).body;

  const agent2 = request.agent(app);
  await login(agent2, other.id);
  await agent2.get(`/api/share/join/${token}`);

  const res = await agent.delete(`/api/share/members/${other.id}`);
  expect(res.status).toBe(200);

  const members = await agent.get('/api/share/members');
  expect(members.body).toHaveLength(0);
});

test('DELETE /api/share/members/:userId member removes self', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const { token } = (await agent.get('/api/share/invite')).body;

  const agent2 = request.agent(app);
  await login(agent2, other.id);
  await agent2.get(`/api/share/join/${token}`);

  const res = await agent2.delete(`/api/share/members/${other.id}`);
  expect(res.status).toBe(200);
});

test('DELETE /api/share/members/:userId non-owner cannot remove other member', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const { token } = (await agent.get('/api/share/invite')).body;

  // both other and third join
  const third = insertUser(db, { discord_id: 'third_discord', username: 'third' });

  const agent2 = request.agent(app);
  await login(agent2, other.id);
  await agent2.get(`/api/share/join/${token}`);

  const agent3 = request.agent(app);
  await login(agent3, third.id);
  await agent3.get(`/api/share/join/${token}`);

  // other tries to remove third — must be 403
  const res = await agent2.delete(`/api/share/members/${third.id}`);
  expect(res.status).toBe(403);
});

test('GET /api/shared/:ownerId/items returns 401 when not logged in', async () => {
  const res = await request(app).get(`/api/shared/${owner.id}/items`);
  expect(res.status).toBe(401);
});

test('GET /api/shared/:ownerId/items returns items to members', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  const { token } = (await agent.get('/api/share/invite')).body;
  await agent.post('/api/items').send({
    platform: 'eBay', order_nr: 'SHARE-1', date: '2026-01-01', buy_price: 40, status: 'Lager'
  });

  const agent2 = request.agent(app);
  await login(agent2, other.id);
  await agent2.get(`/api/share/join/${token}`);

  const res = await agent2.get(`/api/shared/${owner.id}/items`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(1);
});

test('GET /api/shared/:ownerId/items returns 403 for non-members', async () => {
  const agent = request.agent(app);
  await login(agent, other.id);
  const res = await agent.get(`/api/shared/${owner.id}/items`);
  expect(res.status).toBe(403);
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npm test -- tests/share.test.js
```

Expected: FAIL — `Cannot find module '../routes/share'`

- [ ] **Step 5.3: Create routes/share.js**

```js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/share/invite — return current token (create if not exists), never rotates
router.get('/invite', (req, res) => {
  const db = req.db;
  let view = db.prepare('SELECT * FROM shared_views WHERE owner_id = ?').get(req.userId);
  if (!view) {
    db.prepare('INSERT INTO shared_views (owner_id, invite_token) VALUES (?,?)').run(req.userId, uuidv4());
    view = db.prepare('SELECT * FROM shared_views WHERE owner_id = ?').get(req.userId);
  }
  res.json({ token: view.invite_token });
});

// POST /api/share/invite — rotate token (old link becomes invalid, members remain)
router.post('/invite', (req, res) => {
  const db = req.db;
  const newToken = uuidv4();
  const existing = db.prepare('SELECT * FROM shared_views WHERE owner_id = ?').get(req.userId);
  if (existing) {
    db.prepare('UPDATE shared_views SET invite_token = ? WHERE owner_id = ?').run(newToken, req.userId);
  } else {
    db.prepare('INSERT INTO shared_views (owner_id, invite_token) VALUES (?,?)').run(req.userId, newToken);
  }
  res.json({ token: newToken });
});

// GET /api/share/join/:token — join a shared view (must be logged in)
router.get('/join/:token', (req, res) => {
  const db = req.db;
  const view = db.prepare('SELECT * FROM shared_views WHERE invite_token = ?').get(req.params.token);
  if (!view) return res.status(404).json({ error: 'Invalid or expired invite link' });

  if (view.owner_id === req.userId) {
    return res.json({ message: 'You are the owner of this view' });
  }

  db.prepare("INSERT OR IGNORE INTO view_members (view_id, user_id, role) VALUES (?,?,'read')").run(view.id, req.userId);
  res.json({ message: 'Joined successfully', ownerId: view.owner_id });
});

// GET /api/share/members — list members of own shared view
router.get('/members', (req, res) => {
  const db = req.db;
  const view = db.prepare('SELECT * FROM shared_views WHERE owner_id = ?').get(req.userId);
  if (!view) return res.json([]);

  const members = db.prepare(`
    SELECT u.id, u.username, u.avatar, vm.role
    FROM view_members vm
    JOIN users u ON u.id = vm.user_id
    WHERE vm.view_id = ?
  `).all(view.id);

  res.json(members);
});

// PUT /api/share/members/:userId — change role (owner only)
router.put('/members/:userId', (req, res) => {
  const db = req.db;
  const { role } = req.body;
  if (!['read', 'edit'].includes(role)) return res.status(400).json({ error: 'role must be read or edit' });

  const view = db.prepare('SELECT * FROM shared_views WHERE owner_id = ?').get(req.userId);
  if (!view) return res.status(403).json({ error: 'Forbidden' });

  const result = db.prepare('UPDATE view_members SET role = ? WHERE view_id = ? AND user_id = ?')
    .run(role, view.id, parseInt(req.params.userId, 10));

  if (result.changes === 0) return res.status(404).json({ error: 'Member not found' });
  res.json({ success: true });
});

// DELETE /api/share/members/:userId
// Owner can remove anyone. Member can only remove themselves.
router.delete('/members/:userId', (req, res) => {
  const db = req.db;
  const targetId = parseInt(req.params.userId, 10);

  // Self-removal: any authenticated user removing themselves from someone else's view
  if (targetId === req.userId) {
    db.prepare(`
      DELETE FROM view_members
      WHERE user_id = ?
        AND view_id IN (SELECT id FROM shared_views WHERE owner_id != ?)
    `).run(req.userId, req.userId);
    return res.json({ success: true });
  }

  // Must be the owner to remove someone else
  const view = db.prepare('SELECT * FROM shared_views WHERE owner_id = ?').get(req.userId);
  if (!view) return res.status(403).json({ error: 'Forbidden' });

  db.prepare('DELETE FROM view_members WHERE view_id = ? AND user_id = ?').run(view.id, targetId);
  res.json({ success: true });
});

module.exports = router;
```

- [ ] **Step 5.4: Create routes/shared.js**

```js
const express = require('express');
const router = express.Router();
const { requireAuth, requireViewMember } = require('../middleware/auth');

// GET /api/shared/:ownerId/items
// requireAuth must run before requireViewMember
router.get('/:ownerId/items', requireAuth, requireViewMember, (req, res) => {
  const items = req.db.prepare(
    'SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(parseInt(req.params.ownerId, 10));
  res.json(items);
});

module.exports = router;
```

- [ ] **Step 5.5: Run test to verify it passes**

```bash
npm test -- tests/share.test.js
```

Expected: PASS (12 tests)

- [ ] **Step 5.6: Commit**

```bash
git add routes/share.js routes/shared.js tests/share.test.js
git commit -m "feat: add share API with invite, join, and member management"
```

---

## Task 6: Discord OAuth Routes

**Files:**
- Create: `routes/auth.js`

> Discord OAuth cannot be meaningfully unit-tested without mocking the Discord API. The flow is verified manually in Task 9. The `/auth/me` endpoint is simple enough to trust.

- [ ] **Step 6.1: Create routes/auth.js**

```js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');

const {
  DISCORD_CLIENT_ID,
  DISCORD_CLIENT_SECRET,
  DISCORD_REDIRECT_URI,
} = process.env;

const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_USER_URL  = 'https://discord.com/api/users/@me';

// GET /auth/discord — redirect to Discord with state param (CSRF protection)
router.get('/discord', (req, res) => {
  const state = uuidv4();
  req.session.oauthState = state;

  // Preserve pending join token so unauthenticated join links work after OAuth
  if (req.query.joinToken) {
    req.session.pendingJoinToken = req.query.joinToken;
  }

  const url = new URL(DISCORD_AUTH_URL);
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', DISCORD_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);

  // Save session before redirect to ensure state is persisted
  req.session.save(err => {
    if (err) return res.status(500).send('Session error');
    res.redirect(url.toString());
  });
});

// GET /auth/discord/callback
router.get('/discord/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!state || state !== req.session.oauthState) {
    return res.status(403).send('Invalid OAuth state. Please try again.');
  }
  delete req.session.oauthState;

  try {
    // Exchange code for access token
    const tokenRes = await fetch(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const tokenData = await tokenRes.json();

    // Fetch Discord user profile
    const userRes = await fetch(DISCORD_USER_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userRes.ok) throw new Error('Failed to fetch Discord user');
    const discordUser = await userRes.json();

    // Upsert user in DB
    const db = req.db;
    const existing = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordUser.id);
    if (existing) {
      db.prepare('UPDATE users SET username = ?, avatar = ? WHERE discord_id = ?')
        .run(discordUser.username, discordUser.avatar, discordUser.id);
    } else {
      db.prepare('INSERT INTO users (discord_id, username, avatar) VALUES (?,?,?)')
        .run(discordUser.id, discordUser.username, discordUser.avatar);
    }
    const user = db.prepare('SELECT * FROM users WHERE discord_id = ?').get(discordUser.id);

    req.session.userId = user.id;

    // Process pending invite join
    const pendingToken = req.session.pendingJoinToken;
    if (pendingToken) {
      delete req.session.pendingJoinToken;
      const view = db.prepare('SELECT * FROM shared_views WHERE invite_token = ?').get(pendingToken);
      if (view && view.owner_id !== user.id) {
        db.prepare("INSERT OR IGNORE INTO view_members (view_id, user_id, role) VALUES (?,?,'read')")
          .run(view.id, user.id);
        return req.session.save(() => res.redirect(`/?sharedView=${view.owner_id}`));
      }
    }

    req.session.save(() => res.redirect('/'));
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).send('Authentication failed. Please try again.');
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// GET /auth/me — current user info (includes discord_id for avatar URL construction)
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json(null);
  const user = req.db.prepare(
    'SELECT id, discord_id, username, avatar FROM users WHERE id = ?'
  ).get(req.session.userId);
  res.json(user);
});

module.exports = router;
```

- [ ] **Step 6.2: Commit**

```bash
git add routes/auth.js
git commit -m "feat: add Discord OAuth routes with state CSRF protection"
```

---

## Task 7: Wire Server

**Files:**
- Create: `server.js`

- [ ] **Step 7.1: Create server.js**

```js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const SQLiteStore = require('connect-sqlite3')(session);
const { db } = require('./db');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Attach DB to every request
app.use((req, res, next) => { req.db = db; next(); });

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/share', require('./routes/share'));
app.use('/api/shared', require('./routes/shared'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Resell Tracker running on http://localhost:${PORT}`));

module.exports = app;
```

- [ ] **Step 7.2: Run full test suite**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 7.3: Commit**

```bash
git add server.js
git commit -m "feat: wire Express server with all routes and session middleware"
```

---

## Task 8: Login Page

**Files:**
- Create: `public/login.html`

- [ ] **Step 8.1: Create public/login.html**

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resell Tracker – Login</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 48px 40px;
      text-align: center;
      width: 360px;
    }
    .logo { width: 80px; border-radius: 12px; margin-bottom: 24px; }
    h1 { font-size: 1.4rem; margin-bottom: 8px; }
    p { color: #8b949e; font-size: 0.9rem; margin-bottom: 32px; }
    .discord-btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: #5865f2;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.2s;
    }
    .discord-btn:hover { background: #4752c4; }
    .discord-btn svg { width: 22px; height: 22px; }
  </style>
</head>
<body>
  <div class="card">
    <img src="LogoJan.png" alt="Logo" class="logo">
    <h1>Resell Tracker</h1>
    <p>Melde dich mit Discord an, um deine Produkte zu verwalten.</p>
    <a href="/auth/discord" class="discord-btn">
      <svg viewBox="0 0 127.14 96.36" fill="currentColor">
        <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
      </svg>
      Mit Discord anmelden
    </a>
  </div>
</body>
</html>
```

- [ ] **Step 8.2: Commit**

```bash
git add public/login.html
git commit -m "feat: add Discord login page"
```

---

## Task 9: Frontend Migration

**Files:**
- Modify: `public/index.html`

> Work through the existing `index.html` script block section by section. Read the full file before starting.

- [ ] **Step 9.1: Read existing index.html**

Read the full file to understand what needs to change:
```bash
grep -n "localStorage\|function save\|tryStoreItems\|isQuotaError" public/index.html
```

This identifies all localStorage calls, the `save()` function, and quota-handling code that must be removed.

- [ ] **Step 9.2: Add user-badge element to HTML**

In the header section of the HTML (near the title/logo area), add:
```html
<div id="user-badge" style="display:inline-flex;align-items:center;gap:6px"></div>
```

Add a shared-view banner below the header:
```html
<div id="shared-banner" style="display:none;background:#1f2d1f;border:1px solid #238636;border-radius:8px;padding:10px 16px;margin:12px 0;color:#3fb950"></div>
```

- [ ] **Step 9.3: Replace entire script block auth/init section**

Remove the existing password-based login check. Replace with:

```js
let currentUser = null;
let items = [];

async function init() {
  const res = await fetch('/auth/me');
  if (!res.ok || res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  currentUser = await res.json();
  renderUserBadge();

  // Check for shared view redirect
  const params = new URLSearchParams(location.search);
  const sharedOwnerId = params.get('sharedView');
  if (sharedOwnerId) {
    await loadSharedItems(parseInt(sharedOwnerId, 10));
  } else {
    await loadItems();
  }
}

function renderUserBadge() {
  // Use discord_id (snowflake) for the CDN URL, not the internal DB id
  const avatarUrl = currentUser.avatar
    ? `https://cdn.discordapp.com/avatars/${currentUser.discord_id}/${currentUser.avatar}.png?size=32`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
  document.getElementById('user-badge').innerHTML = `
    <img src="${avatarUrl}" style="width:28px;height:28px;border-radius:50%">
    <span>${currentUser.username}</span>
    <button onclick="logout()" style="background:#30363d;border:none;color:#e6edf3;padding:4px 10px;border-radius:6px;cursor:pointer">Logout</button>
  `;
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

init();
```

- [ ] **Step 9.4: Replace item loading**

Delete the old function that reads items from localStorage. Replace with:

```js
async function loadItems() {
  const res = await fetch('/api/items');
  items = await res.json();
  renderItems();
  renderCharts();
}

async function loadSharedItems(ownerId) {
  const res = await fetch(`/api/shared/${ownerId}/items`);
  if (!res.ok) {
    document.getElementById('shared-banner').style.display = 'block';
    document.getElementById('shared-banner').textContent = 'Kein Zugriff auf diese Ansicht.';
    document.getElementById('shared-banner').style.borderColor = '#da3633';
    document.getElementById('shared-banner').style.color = '#f85149';
    return;
  }
  items = await res.json();
  document.getElementById('shared-banner').style.display = 'block';
  document.getElementById('shared-banner').textContent = `Geteilte Ansicht (Benutzer #${ownerId}) – schreibgeschützt`;
  renderItems();
  renderCharts();
}
```

- [ ] **Step 9.5: Replace save() / edit / delete functions**

Delete `save()`, `tryStoreItems()`, `isQuotaError()`, and all quota-handling code. Replace with:

```js
async function saveItem(data) {
  const method = data.id ? 'PUT' : 'POST';
  const url = data.id ? `/api/items/${data.id}` : '/api/items';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    alert('Fehler: ' + (err.errors?.join(', ') || err.error));
    return;
  }
  await loadItems();
}

async function deleteItem(id) {
  if (!confirm('Produkt löschen?')) return;
  await fetch(`/api/items/${id}`, { method: 'DELETE' });
  await loadItems();
}
```

Update the form submit handler to call `saveItem()` with the field mapping:
- `order` → `order_nr`
- `buy` → `buy_price`
- `sell` → `sell_price`

- [ ] **Step 9.6: Replace import/export handlers**

```js
async function exportBackup() {
  window.location.href = '/api/items/export';
}

async function importBackup(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { alert('Ungültige JSON-Datei'); return; }
  const res = await fetch('/api/items/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await res.json();
  alert(`Import: ${result.imported} importiert, ${result.skipped} übersprungen`);
  await loadItems();
}
```

- [ ] **Step 9.7: Add share UI**

Add a "Teilen" button to the header:
```html
<button onclick="toggleShare()" style="background:#30363d;border:none;color:#e6edf3;padding:6px 14px;border-radius:6px;cursor:pointer">Teilen</button>
```

Add share panel HTML (hidden by default, place after header):
```html
<div id="share-panel" style="display:none;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:20px;margin:16px 0">
  <h3 style="margin-bottom:12px">Ansicht teilen</h3>
  <div style="display:flex;gap:8px;margin-bottom:16px">
    <input id="invite-link" readonly style="flex:1;background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:8px;border-radius:6px">
    <button onclick="copyInviteLink()" style="background:#238636;border:none;color:#fff;padding:8px 14px;border-radius:6px;cursor:pointer">Kopieren</button>
    <button onclick="rotateToken()" style="background:#30363d;border:none;color:#e6edf3;padding:8px 14px;border-radius:6px;cursor:pointer">Neu generieren</button>
  </div>
  <div id="members-list"></div>
</div>
```

Add share JS:
```js
async function toggleShare() {
  const panel = document.getElementById('share-panel');
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    await loadSharePanel();
  } else {
    panel.style.display = 'none';
  }
}

async function loadSharePanel() {
  // GET invite = read current token without rotating
  const [inviteRes, membersRes] = await Promise.all([
    fetch('/api/share/invite'),
    fetch('/api/share/members'),
  ]);
  const { token } = await inviteRes.json();
  const members = await membersRes.json();
  document.getElementById('invite-link').value = `${location.origin}/api/share/join/${token}`;
  renderMembers(members);
}

async function rotateToken() {
  // POST = rotate token
  const res = await fetch('/api/share/invite', { method: 'POST' });
  const { token } = await res.json();
  document.getElementById('invite-link').value = `${location.origin}/api/share/join/${token}`;
}

function copyInviteLink() {
  navigator.clipboard.writeText(document.getElementById('invite-link').value);
}

function renderMembers(members) {
  const el = document.getElementById('members-list');
  if (!members.length) { el.innerHTML = '<p style="color:#8b949e">Noch keine Mitglieder</p>'; return; }
  el.innerHTML = members.map(m => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #30363d">
      <span style="flex:1">${m.username}</span>
      <select onchange="setRole(${m.id}, this.value)" style="background:#0d1117;border:1px solid #30363d;color:#e6edf3;padding:4px 8px;border-radius:6px">
        <option value="read" ${m.role==='read'?'selected':''}>Lesen</option>
        <option value="edit" ${m.role==='edit'?'selected':''}>Bearbeiten</option>
      </select>
      <button onclick="removeMember(${m.id})" style="background:#da3633;border:none;color:#fff;padding:4px 10px;border-radius:6px;cursor:pointer">Entfernen</button>
    </div>
  `).join('');
}

async function setRole(userId, role) {
  await fetch(`/api/share/members/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
}

async function removeMember(userId) {
  await fetch(`/api/share/members/${userId}`, { method: 'DELETE' });
  await loadSharePanel();
}
```

- [ ] **Step 9.8: Verify no localStorage references remain**

```bash
grep -n "localStorage" public/index.html
```

Expected: no output. If any remain, remove them and replace with the appropriate API call.

- [ ] **Step 9.9: Manual smoke test**

1. `node server.js`
2. Open `http://localhost:3000` → redirects to `/login.html`
3. Login with Discord → redirects to main app, avatar visible
4. Add a product → appears in list (data survives page refresh)
5. Export backup → JSON file downloads
6. Import that JSON → "0 importiert, N übersprungen"
7. Click "Teilen" → invite link appears, copy it
8. Open invite link in a private window (different browser session) → joins as read member after Discord login
9. As member, view loads shared items

- [ ] **Step 9.10: Commit**

```bash
git add public/index.html public/login.html
git commit -m "feat: migrate frontend from localStorage to REST API with auth and share UI"
```

---

## Task 10: Final Integration

- [ ] **Step 10.1: Run full test suite**

```bash
npm test
```

Expected: All tests PASS with no warnings.

- [ ] **Step 10.2: Check .gitignore**

```bash
git status
```

Expected: `data/` not shown as untracked.

- [ ] **Step 10.3: Final commit**

```bash
git status
git add -A
git commit -m "feat: complete webserver migration"
```

---

## Deployment Notes (VPS)

1. Install Node.js 20+
2. Clone repo, `npm install --production`
3. Copy `.env.example` → `.env`, fill in Discord credentials
4. Register `https://yourdomain.com/auth/discord/callback` as redirect URI in Discord Developer Portal
5. Run: `pm2 start server.js --name resell-tracker`
6. Configure nginx as HTTPS reverse proxy (required for `secure: true` session cookie in production)
