// Keeps admin logins in SQLite so they survive server restarts.
const session = require('express-session');
const { run, one } = require('./db');

class SqliteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = one('SELECT sess, expires FROM sessions WHERE sid=?', sid);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 86400000;
      run('INSERT INTO sessions (sid, sess, expires) VALUES (?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires',
        sid, JSON.stringify(sess), Date.now() + maxAge);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) { try { run('DELETE FROM sessions WHERE sid=?', sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

setInterval(() => { try { run('DELETE FROM sessions WHERE expires < ?', Date.now()); } catch {} }, 3600000).unref();

module.exports = SqliteStore;
