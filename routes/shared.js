const express = require('express');
const router = express.Router();
const { requireAuth, requireViewMember } = require('../middleware/auth');

// GET /api/shared/:ownerId/items
// requireAuth must run before requireViewMember
router.get('/:ownerId/items', requireAuth, requireViewMember, (req, res) => {
  const items = req.db.prepare(
    'SELECT * FROM items WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(parseInt(req.params.ownerId, 10));
  res.json(items);
});

module.exports = router;
