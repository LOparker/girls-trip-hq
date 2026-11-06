const express = require('express');
const { one, all, run, json, token, refCode, tx, notify, setRequestStatus } = require('../db');
const { destinations, bySlug } = require('../content/destinations');
const C = require('../constants');
const emails = require('../emails');
const { rateLimit } = require('../middleware');
const research = require('../research/agent');

const router = express.Router();

const packageView = p => p && ({ ...p, images: json(p.images, []) });
const publicPackages = (where = '', ...params) =>
  all(`SELECT * FROM packages WHERE is_public=1 AND status='Active' ${where} ORDER BY is_sample ASC, updated_at DESC`, ...params).map(packageView);
const formOptions = () => ({ C, destinations });
// The static GitHub Pages copy never shows sample packages.
router.use((req, res, next) => {
  if (res.locals.staticExport) {
    const orig = publicPackages;
    req.pk = (...a) => orig(...a).filter(p => !p.is_sample);
  } else req.pk = publicPackages;
  next();
});

router.get('/', (req, res) => {
  res.render('public/home', { title: null, featured: destinations.slice(0, 8), packages: req.pk().slice(0, 3), ...formOptions() });
});

router.get('/destinations', (req, res) => {
  const region = req.query.region || '';
  const regions = [...new Set(destinations.map(d => d.region))];
  res.render('public/destinations', { title: 'Explore Destinations', list: region ? destinations.filter(d => d.region === region) : destinations, regions, region });
});

router.get('/destinations/:slug', (req, res, next) => {
  const d = bySlug[req.params.slug];
  if (!d) return next();
  res.render('public/destination', { title: d.name, d, packages: req.pk('AND destination_slug=?', d.slug), ...formOptions() });
});

router.get('/packages', (req, res) => {
  const dest = req.query.destination || '';
  const cat = req.query.category || '';
  let list = req.pk();
  if (dest) list = list.filter(p => p.destination_slug === dest);
  if (cat) list = list.filter(p => p.category === cat);
  res.render('public/packages', { title: 'Vacation Packages', list, dest, cat, destinations });
});

router.get('/packages/compare', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean).slice(0, 4);
  const list = ids.length ? publicPackages(`AND id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  res.render('public/compare', { title: 'Compare Packages', list });
});

router.get('/packages/:id', (req, res, next) => {
  const p = packageView(one("SELECT * FROM packages WHERE id=? AND is_public=1 AND status='Active'", Number(req.params.id)));
  if (!p) return next();
  res.render('public/package', { title: p.name, p, d: bySlug[p.destination_slug] });
});

router.get('/plan', (req, res) => res.render('public/plan', { title: 'Plan My Trip', q: req.query, ...formOptions() }));
router.get('/inquiry', (req, res) => res.render('public/inquiry', { title: 'Custom Travel Inquiry', q: req.query, ...formOptions() }));

const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]).filter(Boolean);
const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const int = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : Math.max(0, Math.min(n, 50)); };
const clip = (v, n = 4000) => (v == null ? null : String(v).trim().slice(0, n) || null);

router.post('/inquiry', rateLimit('inquiry', 10, 3600000), (req, res) => {
  const b = req.body;
  if (b.website) return res.redirect('/'); // honeypot field for bots
  const errors = [];
  if (!clip(b.name, 120)) errors.push('Please tell us your name.');
  if (!/^\S+@\S+\.\S+$/.test(b.email || '')) errors.push('Please enter a valid email address.');
  if (!b.consent) errors.push('Please agree to be contacted about your trip.');
  if (b.depart_date && b.return_date && b.return_date < b.depart_date) errors.push('Return date must be after the departure date.');
  if (errors.length) {
    return res.status(400).render(b.source === 'plan' ? 'public/plan' : 'public/inquiry', { title: 'Plan Your Vacation', q: b, errors, ...formOptions() });
  }
  const email = b.email.trim().toLowerCase();
  const result = tx(() => {
    let customer = one('SELECT * FROM customers WHERE lower(email)=? ORDER BY id LIMIT 1', email);
    const prefs = { vacation_style: clip(b.vacation_style, 80), hotel_prefs: arr(b.hotel_prefs), experiences: arr(b.experiences), flight_pref: clip(b.flight_pref, 80) };
    if (!customer) {
      const r = run('INSERT INTO customers (name, email, phone, preferences) VALUES (?,?,?,?)', clip(b.name, 120), email, clip(b.phone, 40), JSON.stringify(prefs));
      customer = { id: Number(r.lastInsertRowid) };
    } else {
      run("UPDATE customers SET phone=COALESCE(?, phone), preferences=?, updated_at=datetime('now') WHERE id=?", clip(b.phone, 40), JSON.stringify(prefs), customer.id);
    }
    const flexibleDest = b.destination_flexible ? 1 : 0;
    const r = run(`INSERT INTO travel_requests (ref_code, access_token, customer_id, destination, destination_flexible, departure_airport, depart_date, return_date,
      flexible_dates, adults, children, rooms, budget_per_person, budget_total, budget_flexible, vacation_style, flight_pref, preferred_airline,
      departure_time_pref, baggage, hotel_prefs, experiences, special_requests, contact_pref, source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      refCode(), token(), customer.id, clip(b.destination, 120), flexibleDest,
      clip(b.departure_airport, 80), clip(b.depart_date, 10), clip(b.return_date, 10), b.flexible_dates === 'yes' ? 1 : 0,
      int(b.adults, 2), int(b.children, 0), int(b.rooms, 1), num(b.budget_per_person), num(b.budget_total), b.budget_flexible === 'yes' ? 1 : 0,
      clip(b.vacation_style, 80), clip(b.flight_pref, 80), clip(b.preferred_airline, 80), clip(b.departure_time_pref, 80), clip(b.baggage, 80),
      JSON.stringify(arr(b.hotel_prefs)), JSON.stringify(arr(b.experiences)), clip(b.special_requests), clip(b.contact_pref, 40), clip(b.source, 20) || 'inquiry');
    const id = Number(r.lastInsertRowid);
    run('INSERT INTO status_history (request_id, to_status, note) VALUES (?,?,?)', id, 'New Inquiry', 'Submitted on website');
    return id;
  });
  const reqRow = one('SELECT * FROM travel_requests WHERE id=?', result);
  emails.draft('inquiry_confirmation', result);
  notify('inquiry', `New trip request ${reqRow.ref_code} for ${reqRow.destination || 'an open destination'}`, `/admin/requests/${result}`);
  // The research assistant prepares a report automatically for every new request.
  research.startRun(result, null, 'Automatic research on new inquiry').catch(e => console.error('research', e));
  res.redirect(`/thank-you/${reqRow.access_token}`);
});

router.get('/thank-you/:token', (req, res, next) => {
  const r = one('SELECT * FROM travel_requests WHERE access_token=?', req.params.token);
  if (!r) return next();
  res.render('public/thank-you', { title: 'Request received', r });
});

// Customer booking status
router.get('/status', (req, res) => res.render('public/status-lookup', { title: 'Booking Status', error: null, q: {} }));
router.post('/status', rateLimit('status', 20, 900000), (req, res) => {
  const r = one(`SELECT t.access_token FROM travel_requests t JOIN customers c ON c.id=t.customer_id
    WHERE upper(t.ref_code)=? AND lower(c.email)=?`, String(req.body.ref || '').trim().toUpperCase(), String(req.body.email || '').trim().toLowerCase());
  if (!r) return res.status(404).render('public/status-lookup', { title: 'Booking Status', error: 'We could not find a request with that reference number and email.', q: req.body });
  res.redirect('/trip/' + r.access_token);
});
router.get('/trip/:token', (req, res, next) => {
  const r = one('SELECT * FROM travel_requests WHERE access_token=?', req.params.token);
  if (!r) return next();
  const c = one('SELECT name FROM customers WHERE id=?', r.customer_id);
  const proposal = one("SELECT token, status, sent_at FROM proposals WHERE request_id=? AND status IN ('Sent','Selected') ORDER BY id DESC LIMIT 1", r.id);
  const booking = ['Confirmed', 'Completed'].includes(r.status)
    ? one("SELECT supplier, confirmation_number, travel_start, travel_end, final_price, payment_status FROM bookings WHERE request_id=? AND booking_status IN ('Confirmed','Completed') ORDER BY id DESC LIMIT 1", r.id)
    : null;
  res.render('public/trip', { title: 'Your Trip', r, c, proposal, booking, s: C.CUSTOMER_STATUS[r.status], steps: C.CUSTOMER_STEPS });
});

// Customer proposal and package selection
function loadProposal(tokenStr) {
  const p = one("SELECT * FROM proposals WHERE token=? AND status IN ('Sent','Selected')", tokenStr);
  if (!p) return null;
  p.request = one('SELECT * FROM travel_requests WHERE id=?', p.request_id);
  p.customer = one('SELECT name FROM customers WHERE id=?', p.customer_id);
  p.items = all('SELECT * FROM proposal_items WHERE proposal_id=? ORDER BY sort, id', p.id).map(i => ({ ...i, pkg: json(i.snapshot, {}) }));
  return p;
}
router.get('/proposal/:token', (req, res, next) => {
  const p = loadProposal(req.params.token);
  if (!p) return next();
  res.render('public/proposal', { title: p.title || 'Your Vacation Proposal', p, justSelected: req.query.selected === '1' });
});
router.post('/proposal/:token/select', rateLimit('select', 20, 900000), (req, res, next) => {
  const p = loadProposal(req.params.token);
  if (!p) return next();
  const item = p.items.find(i => i.id === Number(req.body.item_id));
  if (!item) return res.redirect('/proposal/' + p.token);
  if (p.status === 'Selected' && p.selected_item_id === item.id) return res.redirect(`/proposal/${p.token}?selected=1`);
  tx(() => {
    run("UPDATE proposals SET status='Selected', selected_item_id=?, selected_at=datetime('now'), customer_message=? WHERE id=?",
      item.id, clip(req.body.message, 2000), p.id);
    setRequestStatus(p.request_id, 'Customer Selected Package', null, `Customer selected "${item.pkg.name}" at quoted ${item.customer_total}`);
  });
  notify('selection', `${p.customer.name} selected "${item.pkg.name}" (${p.request.ref_code})`, `/admin/requests/${p.request_id}`);
  emails.draft('selection_ack', p.request_id);
  res.redirect(`/proposal/${p.token}?selected=1`);
});

// Content pages
const page = (view, title) => (req, res) => res.render('public/' + view, { title, destinations, ...formOptions() });
router.get('/about', page('about', 'About Us'));
router.get('/services', page('services', 'Our Services'));
router.get('/inspiration', page('inspiration', 'Travel Inspiration'));
router.get('/faq', page('faq', 'Frequently Asked Questions'));
router.get('/terms', page('terms', 'Terms and Conditions'));
router.get('/privacy', page('privacy', 'Privacy Policy'));
router.get('/contact', (req, res) => res.render('public/contact', { title: 'Contact Us', sent: req.query.sent === '1', errors: null, q: {} }));
router.post('/contact', rateLimit('contact', 8, 3600000), (req, res) => {
  const b = req.body;
  if (b.website) return res.redirect('/contact?sent=1');
  if (!clip(b.name, 120) || !/^\S+@\S+\.\S+$/.test(b.email || '') || !clip(b.message)) {
    return res.status(400).render('public/contact', { title: 'Contact Us', sent: false, errors: ['Please fill in your name, a valid email and a message.'], q: b });
  }
  run('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)', clip(b.name, 120), clip(b.email, 200), clip(b.phone, 40), clip(b.subject, 200), clip(b.message));
  notify('contact', `New contact message from ${clip(b.name, 120)}`, '/admin/messages');
  res.redirect('/contact?sent=1');
});

router.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /proposal\nDisallow: /trip\n'));

module.exports = router;
