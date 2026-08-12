const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');

/**
 * Feste Liste der Pfade, die an den Dealbot weitergereicht werden duerfen.
 * Bewusst kein offener Durchleit-Proxy: kaeme im Bot spaeter eine Route dazu,
 * waere sie sonst sofort ueber das Web erreichbar.
 */
const ALLOWED = [
  { method: 'GET', pattern: /^\/searches$/ },
  { method: 'POST', pattern: /^\/searches$/ },
  { method: 'PATCH', pattern: /^\/searches\/\d+$/ },
  { method: 'DELETE', pattern: /^\/searches\/\d+$/ },
  { method: 'POST', pattern: /^\/searches\/\d+\/(pause|resume|run)$/ },
  { method: 'GET', pattern: /^\/health$/ },
];

router.use(requireAuth);

// Sichtbarkeit des Reiters im Frontend. Bewusst ohne requireAdmin, damit auch
// normale Nutzer eine verwertbare Antwort bekommen (naemlich admin:false).
router.get('/me', (req, res) => {
  const adminId = process.env.ADMIN_DISCORD_ID;
  const user = req.db.prepare('SELECT discord_id FROM users WHERE id = ?').get(req.userId);
  res.json({ admin: !!adminId && !!user && user.discord_id === adminId });
});

router.use(requireAdmin);

router.all('/*', async (req, res) => {
  const target = req.path;
  const allowed = ALLOWED.some((a) => a.method === req.method && a.pattern.test(target));
  if (!allowed) return res.status(404).json({ error: 'Unbekannte Route' });

  const init = {
    method: req.method,
    // Der API-Key bleibt auf dem Server: er geht nur an den Bot, nie zurueck
    // an den Browser.
    headers: {
      'x-api-key': process.env.DEALBOT_API_KEY,
      'content-type': 'application/json',
    },
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = JSON.stringify(req.body ?? {});

  try {
    const upstream = await fetch(process.env.DEALBOT_API_URL + target, init);
    const body = await upstream.json().catch(() => null);
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: 'Bot nicht erreichbar' });
  }
});

module.exports = router;
