const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// GET /api/profile — current user's account balance (Firmenkonto)
router.get('/', (req, res) => {
  const u = req.db.prepare('SELECT balance FROM users WHERE id = ?').get(req.userId);
  res.json({ balance: u ? u.balance : 0 });
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

module.exports = router;
