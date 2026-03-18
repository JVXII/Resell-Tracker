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
