// Discord sends the OAuth callback to exactly one host (DISCORD_REDIRECT_URI).
// The session cookie that holds the OAuth `state` is bound to the host the login
// started on. If the app is opened via another domain (e.g. the old
// sales.cc-8.de), the callback arrives without that cookie and fails with
// "Invalid OAuth state". So every request on a foreign host is redirected to the
// OAuth host before a session is ever created there.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function canonicalHost(redirectUri) {
  let target;
  try { target = new URL(redirectUri); } catch (_) { target = null; }

  return (req, res, next) => {
    if (!target || req.hostname === target.hostname || LOCAL_HOSTS.has(req.hostname)) {
      return next();
    }
    res.redirect(301, target.origin + req.originalUrl);
  };
}

module.exports = { canonicalHost };
