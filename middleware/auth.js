function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  req.userId = req.session.userId;
  next();
}

/**
 * requireViewMember checks that the logged-in user is a member (or owner)
 * of the shared view identified by req.params.ownerId.
 * Sets req.viewRole = 'owner' | 'edit' | 'read' on success.
 * Must be chained after requireAuth.
 */
function requireViewMember(req, res, next) {
  const db = req.db;
  const ownerId = parseInt(req.params.ownerId, 10);

  if (req.userId === ownerId) {
    req.viewRole = 'owner';
    return next();
  }

  const member = db.prepare(`
    SELECT vm.role FROM view_members vm
    JOIN shared_views sv ON sv.id = vm.view_id
    WHERE sv.owner_id = ? AND vm.user_id = ?
  `).get(ownerId, req.userId);

  if (!member) return res.status(403).json({ error: 'Access denied' });
  req.viewRole = member.role;
  next();
}

/**
 * requireAdmin laesst nur den in ADMIN_DISCORD_ID hinterlegten Discord-Account
 * durch. Ist die Variable nicht gesetzt, kommt niemand durch — eine fehlende
 * Konfiguration darf sich nicht in offenen Zugang verwandeln.
 * Muss nach requireAuth verkettet werden.
 */
function requireAdmin(req, res, next) {
  const adminId = process.env.ADMIN_DISCORD_ID;
  if (!adminId) return res.status(403).json({ error: 'Access denied' });

  const user = req.db.prepare('SELECT discord_id FROM users WHERE id = ?').get(req.userId);
  if (!user || user.discord_id !== adminId) return res.status(403).json({ error: 'Access denied' });

  next();
}

module.exports = { requireAuth, requireViewMember, requireAdmin };