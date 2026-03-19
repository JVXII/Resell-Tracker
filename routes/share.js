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
