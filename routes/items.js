const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

const VALID_STATUSES = ['Gekauft', 'Lager', 'Verkauft'];
const VALID_SEGMENTS = ['reselling', 'handel'];

function validateMoneyFields(body) {
  const errors = [];
  if ('segment' in body && !VALID_SEGMENTS.includes(body.segment)) errors.push(`segment must be one of: ${VALID_SEGMENTS.join(', ')}`);
  for (const field of ['shipping_cost', 'part_shipping']) {
    if (body[field] != null && (typeof body[field] !== 'number' || body[field] < 0)) errors.push(`${field} must be a non-negative number`);
  }
  return errors;
}

function isValidLotQty(qty) { return Number.isInteger(qty) && qty >= 1; }

function validateItem(body) {
  const errors = validateMoneyFields(body);
  const isLotOrPart = body.is_lot || body.parent_id;
  if (body.is_lot && !isValidLotQty(body.lot_qty)) errors.push('lot_qty must be a whole number of at least 1');
  if (!body.platform) errors.push('platform required');
  if (!body.order_nr && !isLotOrPart) errors.push('order_nr required');
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
    INSERT INTO items (owner_id, platform, title, sell_platform, order_nr, date, sold_date, buy_price, sell_price, status, tracking, image, owned, is_lot, parent_id, part_price, segment, shipping_cost, lot_qty, part_shipping)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
        e.title || null,
        e.sell_platform || null,
        orderNr,
        e.date || new Date().toISOString().split('T')[0],
        e.sold_date ?? null,
        typeof e.buy === 'number' ? e.buy : (e.buy_price ?? 0),
        typeof e.sell === 'number' ? e.sell : (e.sell_price ?? null),
        status,
        e.tracking || null,
        e.image || null,
        e.owned ? 1 : 0,
        e.is_lot ? 1 : 0,
        e.parent_id ?? null,
        e.part_price ?? null,
        VALID_SEGMENTS.includes(e.segment) ? e.segment : 'reselling',
        e.shipping_cost ?? 0,
        e.lot_qty ?? null,
        e.part_shipping ?? null
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
    title: i.title || null,
    sell_platform: i.sell_platform || null,
    order: i.order_nr,
    date: i.date,
    sold_date: i.sold_date ?? null,
    buy: i.buy_price,
    sell: i.sell_price,
    status: i.status,
    tracking: i.tracking,
    image: i.image,
    owned: i.owned || 0,
    is_lot: i.is_lot || 0,
    parent_id: i.parent_id ?? null,
    part_price: i.part_price ?? null,
    segment: i.segment,
    shipping_cost: i.shipping_cost,
    lot_qty: i.lot_qty ?? null,
    part_shipping: i.part_shipping ?? null,
  }));
  res.setHeader('Content-Disposition', 'attachment; filename="resell-backup.json"');
  res.json(exported);
});

// POST /api/items
router.post('/', (req, res) => {
  const errors = validateItem(req.body);
  if (errors.length) return res.status(400).json({ errors });

  const { platform, title, sell_platform, order_nr, date, sold_date, buy_price, sell_price, status, tracking, image, owned, is_lot, parent_id, part_price, segment, shipping_cost, lot_qty, part_shipping } = req.body;
  const result = req.db.prepare(`
    INSERT INTO items (owner_id, platform, title, sell_platform, order_nr, date, sold_date, buy_price, sell_price, status, tracking, image, owned, is_lot, parent_id, part_price, segment, shipping_cost, lot_qty, part_shipping)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.userId, platform, title ?? null, sell_platform ?? null, order_nr ?? '', date, sold_date ?? null, buy_price, sell_price ?? null, status, tracking ?? null, image ?? null, owned ? 1 : 0, is_lot ? 1 : 0, parent_id ?? null, part_price ?? null, segment ?? 'reselling', shipping_cost ?? 0, lot_qty ?? null, part_shipping ?? null);

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

  const allowed = ['platform', 'title', 'sell_platform', 'order_nr', 'date', 'sold_date', 'buy_price', 'sell_price', 'status', 'tracking', 'image', 'owned', 'is_lot', 'parent_id', 'part_price', 'segment', 'shipping_cost', 'lot_qty', 'part_shipping'];
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));

  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const fieldErrors = validateMoneyFields(updates);
  if (fieldErrors.length) return res.status(400).json({ errors: fieldErrors });
  if ('shipping_cost' in updates) updates.shipping_cost = updates.shipping_cost ?? 0;
  const merged = { ...item, ...updates };
  if (('is_lot' in updates || 'lot_qty' in updates) && merged.is_lot && !isValidLotQty(merged.lot_qty)) {
    return res.status(400).json({ errors: ['lot_qty must be a whole number of at least 1'] });
  }
  if ('owned' in updates) updates.owned = updates.owned ? 1 : 0;
  if ('is_lot' in updates) updates.is_lot = updates.is_lot ? 1 : 0;

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

  // Ein Lot löscht seine Teil-Verkäufe (Kinder) mit
  if (item.is_lot) req.db.prepare('DELETE FROM items WHERE parent_id = ? AND owner_id = ?').run(req.params.id, req.userId);
  req.db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
