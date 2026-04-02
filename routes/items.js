const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const VALID_STATUSES = ['Gekauft', 'Lager', 'Verkauft'];

function validateItem(body) {
  const errors = [];
  if (!body.platform) errors.push('platform required');
  if (!body.order_nr) errors.push('order_nr required');
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) errors.push('date must be YYYY-MM-DD');
  if (typeof body.buy_price !== 'number' || body.buy_price < 0) errors.push('buy_price must be a non-negative number');
  if (!VALID_STATUSES.includes(body.status)) errors.push(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  return errors;
}

router.use(requireAuth);

// GET /api/items — own items
router.get('/', (req, res) => {
  const items = req.db.prepare(
    'SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(req.userId);
  res.json(items);
});

// POST /api/items/import — MUST be before POST /
router.post('/import', (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'Expected array' });

  let imported = 0, skipped = 0;

  const existsStmt = req.db.prepare('SELECT 1 FROM items WHERE owner_id = ? AND order_nr = ?');
  const insertStmt = req.db.prepare(`
    INSERT INTO items (owner_id, platform, sell_platform, order_nr, date, buy_price, sell_price, status, tracking, image)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  req.db.exec('BEGIN');
  try {
    for (const e of entries) {
      const orderNr = e.order || e.order_nr;
      if (!orderNr) { skipped++; continue; }
      if (existsStmt.get(req.userId, orderNr)) { skipped++; continue; }

      const status = VALID_STATUSES.includes(e.status) ? e.status : 'Lager';
      insertStmt.run(
        req.userId,
        e.platform || '',
        e.sell_platform || null,
        orderNr,
        e.date || new Date().toISOString().split('T')[0],
        typeof e.buy === 'number' ? e.buy : (e.buy_price ?? 0),
        typeof e.sell === 'number' ? e.sell : (e.sell_price ?? null),
        status,
        e.tracking || null,
        e.image || null
      );
      imported++;
    }
    req.db.exec('COMMIT');
  } catch (err) {
    req.db.exec('ROLLBACK');
    throw err;
  }
  res.json({ imported, skipped });
});

// GET /api/items/export — MUST be before GET /:id
router.get('/export', (req, res) => {
  const items = req.db.prepare(
    'SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(req.userId);
  const exported = items.map(i => ({
    platform: i.platform,
    sell_platform: i.sell_platform || null,
    order: i.order_nr,
    date: i.date,
    buy: i.buy_price,
    sell: i.sell_price,
    status: i.status,
    tracking: i.tracking,
    image: i.image,
  }));
  res.setHeader('Content-Disposition', 'attachment; filename="resell-backup.json"');
  res.json(exported);
});

// POST /api/items
router.post('/', (req, res) => {
  const errors = validateItem(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const { platform, sell_platform, order_nr, date, buy_price, sell_price, status, tracking, image } = req.body;
  const result = req.db.prepare(`
    INSERT INTO items (owner_id, platform, sell_platform, order_nr, date, buy_price, sell_price, status, tracking, image)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(req.userId, platform, sell_platform ?? null, order_nr, date, buy_price, sell_price ?? null, status, tracking ?? null, image ?? null);

  const item = req.db.prepare('SELECT * FROM items WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(item);
});

// PUT /api/items/:id
router.put('/:id', (req, res) => {
  const item = req.db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  const isOwner = item.owner_id === req.userId;
  let canEdit = isOwner;

  if (!canEdit) {
    const member = req.db.prepare(`
      SELECT vm.role FROM view_members vm
      JOIN shared_views sv ON sv.id = vm.view_id
      WHERE sv.owner_id = ? AND vm.user_id = ?
    `).get(item.owner_id, req.userId);
    canEdit = member?.role === 'edit';
  }

  if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

  const allowed = ['platform', 'sell_platform', 'order_nr', 'date', 'buy_price', 'sell_price', 'status', 'tracking', 'image'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  req.db.prepare(`UPDATE items SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);
  const updated = req.db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE /api/items/:id — owner only
router.delete('/:id', (req, res) => {
  const item = req.db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.owner_id !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  req.db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
