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
  // Neue Nutzer starten privat; die Sharing-Tests hier pruefen den offenen Fall,
  // die Privat-Modus-Tests weiter unten schalten ihn per setPrivate wieder an.
  db.prepare('UPDATE users SET private_mode = 0').run();
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

// ---- Privat-Modus -------------------------------------------------------
// Ist er aktiv, darf kein Link herausgegeben, kein Beitritt erfolgen und auch
// bereits beigetretene Mitglieder duerfen die Daten nicht mehr sehen.

function setPrivate(db, userId, on) {
  db.prepare('UPDATE users SET private_mode = ? WHERE id = ?').run(on ? 1 : 0, userId);
}

test('neue Nutzer starten im Privat-Modus', () => {
  const fresh = insertUser(db, { discord_id: 'fresh_discord', username: 'fresh' });
  const row = db.prepare('SELECT private_mode FROM users WHERE id = ?').get(fresh.id);
  expect(row.private_mode).toBe(1);
});

test('Privat-Modus: GET /api/share/invite gibt keinen Link heraus', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  setPrivate(db, owner.id, true);
  const res = await agent.get('/api/share/invite');
  expect(res.status).toBe(403);
  expect(res.body.error).toMatch(/[Pp]rivat/);
});

test('Privat-Modus: Token-Rotation ist gesperrt', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  setPrivate(db, owner.id, true);
  expect((await agent.post('/api/share/invite')).status).toBe(403);
});

test('Privat-Modus: Beitritt ueber gueltigen Link wird abgewiesen', async () => {
  const ownerAgent = request.agent(app);
  await login(ownerAgent, owner.id);
  const { token } = (await ownerAgent.get('/api/share/invite')).body;

  setPrivate(db, owner.id, true);

  const otherAgent = request.agent(app);
  await login(otherAgent, other.id);
  const res = await otherAgent.get(`/api/share/join/${token}`);
  expect(res.status).toBe(403);
  expect(db.prepare('SELECT COUNT(*) c FROM view_members').get().c).toBe(0);
});

test('Privat-Modus sperrt auch bereits beigetretene Mitglieder aus', async () => {
  const ownerAgent = request.agent(app);
  await login(ownerAgent, owner.id);
  const { token } = (await ownerAgent.get('/api/share/invite')).body;

  const otherAgent = request.agent(app);
  await login(otherAgent, other.id);
  await otherAgent.get(`/api/share/join/${token}`);
  expect((await otherAgent.get(`/api/shared/${owner.id}/items`)).status).toBe(200);

  setPrivate(db, owner.id, true);
  expect((await otherAgent.get(`/api/shared/${owner.id}/items`)).status).toBe(403);

  // Mitgliedschaft bleibt bestehen und lebt nach dem Abschalten wieder auf
  expect(db.prepare('SELECT COUNT(*) c FROM view_members').get().c).toBe(1);
  setPrivate(db, owner.id, false);
  expect((await otherAgent.get(`/api/shared/${owner.id}/items`)).status).toBe(200);
});

test('Privat-Modus des Besitzers sperrt ihn nicht aus seinen eigenen Daten aus', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  setPrivate(db, owner.id, true);
  expect((await agent.get(`/api/shared/${owner.id}/items`)).status).toBe(200);
});

test('Mitgliederliste bleibt im Privat-Modus sichtbar (zum Verwalten)', async () => {
  const agent = request.agent(app);
  await login(agent, owner.id);
  setPrivate(db, owner.id, true);
  expect((await agent.get('/api/share/members')).status).toBe(200);
});
