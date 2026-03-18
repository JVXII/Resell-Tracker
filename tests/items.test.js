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