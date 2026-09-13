const request = require('supertest');
const { createTestDb, createTestApp, insertUser } = require('./helpers');
const profileRouter = require('../routes/profile');

let db, app, user;

beforeEach(() => {
  db = createTestDb();
  app = createTestApp(db, { '/api/profile': profileRouter });
  user = insertUser(db);
});

async function loggedIn() {
  const agent = request.agent(app);
  await agent.post('/test-login').send({ userId: user.id });
  return agent;
}

test('GET /api/profile requires auth', async () => {
  const res = await request(app).get('/api/profile');
  expect(res.status).toBe(401);
});

test('new user has no goal', async () => {
  const agent = await loggedIn();
  const res = await agent.get('/api/profile');
  expect(res.status).toBe(200);
  expect(res.body.goal).toBeNull();
});

test('PUT /api/profile/goal stores and returns the goal', async () => {
  const agent = await loggedIn();
  const res = await agent.put('/api/profile/goal')
    .send({ title: 'Gewinn 2026', target: 5000, current: 1250, unit: 'eur' });
  expect(res.status).toBe(200);
  expect(res.body.goal).toEqual({ title: 'Gewinn 2026', target: 5000, current: 1250, unit: 'eur' });

  const get = await agent.get('/api/profile');
  expect(get.body.goal.current).toBe(1250);
});

test('goal is per user — a second user does not see it', async () => {
  const agent = await loggedIn();
  await agent.put('/api/profile/goal').send({ title: 'Mein Ziel', target: 100, current: 10 });

  const other = insertUser(db, { discord_id: 'other-1', username: 'other' });
  const agent2 = request.agent(app);
  await agent2.post('/test-login').send({ userId: other.id });
  const res = await agent2.get('/api/profile');
  expect(res.body.goal).toBeNull();
});

test('invalid target is rejected', async () => {
  const agent = await loggedIn();
  for (const target of [0, -5, 'abc', undefined]) {
    const res = await agent.put('/api/profile/goal').send({ target, current: 0 });
    expect(res.status).toBe(400);
  }
});

test('unknown unit falls back to eur, empty title to default', async () => {
  const agent = await loggedIn();
  const res = await agent.put('/api/profile/goal').send({ title: '  ', target: 20, current: 0, unit: 'bananas' });
  expect(res.body.goal.unit).toBe('eur');
  expect(res.body.goal.title).toBe('Dein Ziel');
});

test('DELETE /api/profile/goal clears the goal', async () => {
  const agent = await loggedIn();
  await agent.put('/api/profile/goal').send({ title: 'X', target: 10, current: 5, unit: 'stk' });
  const del = await agent.delete('/api/profile/goal');
  expect(del.status).toBe(200);
  const get = await agent.get('/api/profile');
  expect(get.body.goal).toBeNull();
});
