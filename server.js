// Entry point: node server.js  (then open http://localhost:3000)
process.removeAllListeners('warning'); // hide Node's "SQLite is experimental" notice
const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./src/config');
require('./src/db');
const SqliteStore = require('./src/session-store');
const locals = require('./src/helpers');
const { csrf, verifyCsrfUnlessMultipart, loadUser, securityHeaders } = require('./src/middleware');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(securityHeaders);
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(session({
  store: new SqliteStore(),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'agency.sid',
  cookie: { httpOnly: true, sameSite: 'lax', secure: config.baseUrl.startsWith('https'), maxAge: 1000 * 60 * 60 * 12 }
}));
app.use(csrf);
app.use(loadUser);
app.use(locals);
app.use(verifyCsrfUnlessMultipart);
// Static export mode (scripts/export-static.js): renders the public pages for GitHub Pages.
app.use((req, res, next) => {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  res.locals.staticExport = local && req.get('x-static-export') === '1';
  res.locals.staticFormEndpoint = process.env.STATIC_FORM_ENDPOINT || '';
  next();
});

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => res.status(404).render('public/error', { title: 'Page not found', message: 'We could not find that page. It may have moved.' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('public/error', { title: 'Something went wrong', message: 'Sorry, something went wrong on our end. Please try again.' });
});

app.listen(config.port, () => {
  console.log(`\n  ${config.brand.name} is running`);
  console.log(`  Website:   ${config.baseUrl}`);
  console.log(`  Dashboard: ${config.baseUrl}/admin`);
  console.log(`  AI research summaries: ${config.ai.enabled ? 'ON (' + config.ai.model + ')' : 'OFF (set ANTHROPIC_API_KEY to enable)'}\n`);
  if (!process.env.SESSION_SECRET) console.log('  WARNING: set SESSION_SECRET to a long random value before putting this online.\n');
});
