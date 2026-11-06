const crypto = require('crypto');
const { one } = require('./db');

// CSRF protection: every form carries a per session token.
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(20).toString('hex');
  res.locals.csrf = req.session.csrf;
  next();
}
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const t = (req.body && req.body._csrf) || req.get('x-csrf-token');
  if (!t || t !== req.session.csrf) return res.status(403).render('public/error', { title: 'Form expired', message: 'This form expired. Please go back, refresh the page and try again.' });
  next();
}
// Multipart forms are parsed by multer inside the route, so check after it runs.
function verifyCsrfUnlessMultipart(req, res, next) {
  if ((req.get('content-type') || '').startsWith('multipart/form-data')) return next();
  return verifyCsrf(req, res, next);
}

function loadUser(req, res, next) {
  res.locals.user = null;
  if (req.session.userId) {
    const u = one('SELECT id, name, email, role FROM users WHERE id=? AND active=1', req.session.userId);
    if (u) { req.user = u; res.locals.user = u; } else { delete req.session.userId; }
  }
  next();
}
function requireStaff(req, res, next) {
  if (!req.user) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}
function requireOwner(req, res, next) {
  if (!req.user || req.user.role !== 'owner') return res.status(403).render('admin/denied', { title: 'Owner access only' });
  next();
}

// Very small in-memory rate limiter for login and public forms.
const hits = new Map();
function rateLimit(key, max, windowMs) {
  return (req, res, next) => {
    const k = key + ':' + req.ip;
    const nowMs = Date.now();
    const rec = (hits.get(k) || []).filter(t => nowMs - t < windowMs);
    if (rec.length >= max) return res.status(429).send('Too many attempts. Please wait a few minutes and try again.');
    rec.push(nowMs); hits.set(k, rec); next();
  };
}

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/admin') || req.path.startsWith('/proposal') || req.path.startsWith('/trip')) {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
  }
  next();
}

module.exports = { csrf, verifyCsrf, verifyCsrfUnlessMultipart, loadUser, requireStaff, requireOwner, rateLimit, securityHeaders };
