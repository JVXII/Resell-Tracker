const express = require('express');
const request = require('supertest');
const { canonicalHost } = require('../middleware/canonical-host');

function makeApp(redirectUri) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(canonicalHost(redirectUri));
  app.get('*', (req, res) => res.send('ok'));
  return app;
}

const URI = 'https://dashboard.jvxi.de/auth/discord/callback';

test('redirects a foreign host to the OAuth host, keeping path and query', async () => {
  const res = await request(makeApp(URI))
    .get('/auth/discord?joinToken=abc')
    .set('Host', 'sales.cc-8.de');
  expect(res.status).toBe(301);
  expect(res.headers.location).toBe('https://dashboard.jvxi.de/auth/discord?joinToken=abc');
});

test('passes requests on the OAuth host through', async () => {
  const res = await request(makeApp(URI)).get('/login.html').set('Host', 'dashboard.jvxi.de');
  expect(res.status).toBe(200);
});

test('passes localhost requests through (local dev, health checks)', async () => {
  const res = await request(makeApp(URI)).get('/').set('Host', 'localhost:3000');
  expect(res.status).toBe(200);
});

test('does nothing when no redirect URI is configured', async () => {
  const res = await request(makeApp(undefined)).get('/').set('Host', 'sales.cc-8.de');
  expect(res.status).toBe(200);
});
