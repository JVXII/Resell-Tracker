const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

function validate(body) {
  const errors = [];
  if (typeof body.amount !== 'number' || !isFinite(body.amount) || body.amount < 0) {
    errors.push('amount must be a non-negative number');
  }
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.push('date must be YYYY-MM-DD');
  if (!body.category || !String(body.category).trim()) errors.push('category required');
  return errors;
}

router.use(requireAuth);

// GET /api/expenses — own expenses
router.get('/', (req, res) => {
  const rows = req.db.prepare(
    'SELECT * FROM expenses WHERE owner_id = ? ORDER BY date DESC, id DESC'
  ).all(req.userId);
  res.json(rows);
});

// POST /api/expenses
router.post('/', (req, res) => {
  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const { date, amount, category, note } = req.body;
  const result = req.db.prepare(
    'INSERT INTO expenses (owner_id, date, amount, category, note) VALUES (?,?,?,?,?)'
  ).run(req.userId, date, amount, String(category).trim(), note ?? null);
  const row = req.db.prepare('SELECT * FROM expenses WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(row);
});

// PUT /api/expenses/:id — owner only
router.put('/:id', (req, res) => {
  const row = req.db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.owner_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const errors = validate(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const { date, amount, category, note } = req.body;
  req.db.prepare(
    'UPDATE expenses SET date = ?, amount = ?, category = ?, note = ? WHERE id = ?'
  ).run(date, amount, String(category).trim(), note ?? null, req.params.id);
  const updated = req.db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/expenses/:id — owner only
router.delete('/:id', (req, res) => {
  const row = req.db.prepare('SELECT * FROM expenses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.owner_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });
  req.db.prepare('DELETE FROM expenses WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
