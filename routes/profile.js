const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const UNITS = ['eur', 'stk'];

function goalOf(u) {
  if (!u || u.goal_target == null) return null;
  return {
    title: u.goal_title || 'Dein Ziel',
    target: u.goal_target,
    current: u.goal_current || 0,
    unit: UNITS.includes(u.goal_unit) ? u.goal_unit : 'eur',
  };
}

// GET /api/profile — current user's account balance (Firmenkonto) + personal goal
router.get('/', (req, res) => {
  const u = req.db
    .prepare('SELECT balance, goal_title, goal_target, goal_current, goal_unit, private_mode FROM users WHERE id = ?')
    .get(req.userId);
  res.json({ balance: u ? u.balance : 0, goal: goalOf(u), privateMode: !u || u.private_mode === 1 });
});

// PUT /api/profile/balance — update account balance
router.put('/balance', (req, res) => {
  const balance = parseFloat(req.body.balance);
  if (!Number.isFinite(balance)) {
    return res.status(400).json({ error: 'balance must be a number' });
  }
  req.db.prepare('UPDATE users SET balance = ? WHERE id = ?').run(balance, req.userId);
  res.json({ balance });
});

// PUT /api/profile/private — Privat-Modus schalten
router.put('/private', (req, res) => {
  const on = req.body.privateMode;
  if (typeof on !== 'boolean') {
    return res.status(400).json({ error: 'privateMode must be a boolean' });
  }
  req.db.prepare('UPDATE users SET private_mode = ? WHERE id = ?').run(on ? 1 : 0, req.userId);
  res.json({ privateMode: on });
});

// PUT /api/profile/goal — set the user's personal goal
router.put('/goal', (req, res) => {
  const target = parseFloat(req.body.target);
  const current = parseFloat(req.body.current);
  if (!Number.isFinite(target) || target <= 0) {
    return res.status(400).json({ error: 'target must be a positive number' });
  }
  if (!Number.isFinite(current) || current < 0) {
    return res.status(400).json({ error: 'current must be a number >= 0' });
  }
  const unit = UNITS.includes(req.body.unit) ? req.body.unit : 'eur';
  const title = String(req.body.title || '').trim().slice(0, 60) || 'Dein Ziel';
  req.db
    .prepare('UPDATE users SET goal_title = ?, goal_target = ?, goal_current = ?, goal_unit = ? WHERE id = ?')
    .run(title, target, current, unit, req.userId);
  res.json({ goal: { title, target, current, unit } });
});

// DELETE /api/profile/goal — remove the goal (card falls back to placeholder)
router.delete('/goal', (req, res) => {
  req.db
    .prepare('UPDATE users SET goal_title = NULL, goal_target = NULL, goal_current = 0 WHERE id = ?')
    .run(req.userId);
  res.json({ goal: null });
});

module.exports = router;
