const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const config = require('../config');
const { one, all, run, json, token, now, tx, notify, setRequestStatus } = require('../db');
const C = require('../constants');
const emails = require('../emails');
const research = require('../research/agent');
const { destinations, bySlug } = require('../content/destinations');
const { requireStaff, requireOwner, rateLimit, verifyCsrf } = require('../middleware');

const router = express.Router();
const clip = (v, n = 8000) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const flash = (req, msg, kind = 'ok') => { req.session.flash = { msg, kind }; };
router.use((req, res, next) => { res.locals.flash = req.session.flash; delete req.session.flash; res.locals.C = C; next(); });

const safeName = ext => crypto.randomBytes(12).toString('hex') + ext;
const imageUpload = multer({
  storage: multer.diskStorage({ destination: config.uploadDir, filename: (req, f, cb) => cb(null, safeName(path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.jpg')) }),
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp|avif)$/.test(f.mimetype))
});
const docUpload = multer({
  storage: multer.diskStorage({ destination: config.privateDocDir, filename: (req, f, cb) => cb(null, safeName(path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g, ''))) }),
  limits: { fileSize: 15 * 1024 * 1024, files: 5 },
  fileFilter: (req, f, cb) => cb(null, /pdf|image\/|msword|officedocument|text\/plain/.test(f.mimetype))
});

// ---------- auth ----------
router.get('/setup', (req, res) => {
  if (one('SELECT COUNT(*) c FROM users').c > 0) return res.redirect('/admin/login');
  res.render('admin/setup', { title: 'Create owner account', error: null });
});
router.post('/setup', rateLimit('setup', 5, 900000), (req, res) => {
  if (one('SELECT COUNT(*) c FROM users').c > 0) return res.redirect('/admin/login');
  const { name, email, password } = req.body;
  if (!clip(name) || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 10)
    return res.status(400).render('admin/setup', { title: 'Create owner account', error: 'Enter your name, email and a password of at least 10 characters.' });
  const r = run('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', clip(name, 120), email.trim().toLowerCase(), bcrypt.hashSync(password, 12), 'owner');
  req.session.regenerate(() => { req.session.userId = Number(r.lastInsertRowid); res.redirect('/admin'); });
});
router.get('/login', (req, res) => {
  if (one('SELECT COUNT(*) c FROM users').c === 0) return res.redirect('/admin/setup');
  res.render('admin/login', { title: 'Sign in', error: null, next: req.query.next || '/admin' });
});
router.post('/login', rateLimit('login', 10, 900000), (req, res) => {
  const u = one('SELECT * FROM users WHERE lower(email)=? AND active=1', String(req.body.email || '').trim().toLowerCase());
  const nextUrl = String(req.body.next || '/admin').startsWith('/admin') ? req.body.next : '/admin';
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash))
    return res.status(401).render('admin/login', { title: 'Sign in', error: 'That email and password did not match.', next: nextUrl });
  req.session.regenerate(() => { req.session.userId = u.id; res.redirect(nextUrl); });
});
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/admin/login')));

router.use(requireStaff);
router.use((req, res, next) => { res.locals.unread = one('SELECT COUNT(*) c FROM notifications WHERE is_read=0').c; res.locals.adminPath = req.path; next(); });

// ---------- dashboard ----------
router.get('/', (req, res) => {
  const count = s => one('SELECT COUNT(*) c FROM travel_requests WHERE status=?', s).c;
  const stats = [
    ['New inquiries', count('New Inquiry'), 'New Inquiry'],
    ['Research pending', count('Research Pending'), 'Research Pending'],
    ['Research completed', count('Research Completed'), 'Research Completed'],
    ['Quotes awaiting review', count('Awaiting Agent Review'), 'Awaiting Agent Review'],
    ['Proposals sent', count('Quote Sent') + count('Awaiting Customer Selection'), 'Awaiting Customer Selection'],
    ['Customer selected', count('Customer Selected Package'), 'Customer Selected Package'],
    ['Bookings in progress', count('Booking in Progress'), 'Booking in Progress'],
    ['Confirmed bookings', count('Confirmed'), 'Confirmed']
  ];
  const upcoming = all(`SELECT b.*, c.name customer_name, t.destination, t.ref_code FROM bookings b JOIN customers c ON c.id=b.customer_id
    JOIN travel_requests t ON t.id=b.request_id WHERE b.booking_status='Confirmed' AND b.travel_start >= date('now') ORDER BY b.travel_start LIMIT 8`);
  const recent = all(`SELECT t.*, c.name customer_name FROM travel_requests t JOIN customers c ON c.id=t.customer_id ORDER BY t.created_at DESC LIMIT 8`);
  const notes = all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 8');
  const drafts = one("SELECT COUNT(*) c FROM communications WHERE status='Draft'").c;
  res.render('admin/dashboard', { title: 'Dashboard', stats, upcoming, recent, notes, drafts });
});

router.get('/notifications', (req, res) => {
  const list = all('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200');
  run('UPDATE notifications SET is_read=1 WHERE is_read=0');
  res.render('admin/notifications', { title: 'Notifications', list });
});

// ---------- requests ----------
router.get('/requests', (req, res) => {
  const status = req.query.status || '';
  const q = clip(req.query.q, 100);
  let sql = `SELECT t.*, c.name customer_name, c.email FROM travel_requests t JOIN customers c ON c.id=t.customer_id WHERE 1=1`;
  const p = [];
  if (status) { sql += ' AND t.status=?'; p.push(status); }
  if (q) { sql += ' AND (c.name LIKE ? OR c.email LIKE ? OR t.destination LIKE ? OR t.ref_code LIKE ?)'; p.push(...Array(4).fill('%' + q + '%')); }
  res.render('admin/requests', { title: 'Trip Requests', list: all(sql + ' ORDER BY t.created_at DESC LIMIT 300', ...p), status, q });
});

function loadRequest(id) {
  const r = one('SELECT * FROM travel_requests WHERE id=?', id);
  if (!r) return null;
  r.customer = one('SELECT * FROM customers WHERE id=?', r.customer_id);
  r.hotelPrefs = json(r.hotel_prefs, []);
  r.exp = json(r.experiences, []);
  return r;
}

router.get('/requests/:id', (req, res, next) => {
  const r = loadRequest(Number(req.params.id));
  if (!r) return next();
  const runs = all('SELECT id, status, progress, decision, started_at, completed_at, instructions FROM research_runs WHERE request_id=? ORDER BY id DESC', r.id);
  const history = all('SELECT h.*, u.name user_name FROM status_history h LEFT JOIN users u ON u.id=h.changed_by WHERE request_id=? ORDER BY h.id DESC', r.id);
  const notes = all('SELECT n.*, u.name user_name FROM request_notes n LEFT JOIN users u ON u.id=n.author_id WHERE request_id=? ORDER BY n.id DESC', r.id);
  const packages = all('SELECT * FROM packages WHERE request_id=? ORDER BY id DESC', r.id);
  const proposals = all('SELECT * FROM proposals WHERE request_id=? ORDER BY id DESC', r.id);
  const selected = one(`SELECT pi.*, p.token, p.selected_at, p.customer_message FROM proposals p JOIN proposal_items pi ON pi.id=p.selected_item_id
    WHERE p.request_id=? AND p.status='Selected' ORDER BY p.selected_at DESC LIMIT 1`, r.id);
  if (selected) selected.pkg = json(selected.snapshot, {});
  const bookings = all('SELECT * FROM bookings WHERE request_id=? ORDER BY id DESC', r.id);
  const comms = all('SELECT * FROM communications WHERE request_id=? ORDER BY id DESC', r.id);
  const manual = all("SELECT * FROM research_results WHERE request_id=? AND entered_by='agent_user' ORDER BY id DESC", r.id);
  const previous = all('SELECT id, ref_code, destination, status, created_at FROM travel_requests WHERE customer_id=? AND id!=? ORDER BY id DESC', r.customer_id, r.id);
  res.render('admin/request', { title: `${r.ref_code} · ${r.customer.name}`, r, runs, history, notes, packages, proposals, selected, bookings, comms, manual, previous });
});

router.post('/requests/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const to = req.body.status;
  if (!C.REQUEST_STATUSES.includes(to)) return res.redirect('/admin/requests/' + id);
  if (['Confirmed', 'Completed'].includes(to) && !one("SELECT id FROM bookings WHERE request_id=? AND booking_status IN ('Confirmed','Completed') AND confirmation_number IS NOT NULL", id)) {
    flash(req, 'A trip can only be marked Confirmed after you record the supplier confirmation on a booking (Bookings > Confirm reservation).', 'error');
    return res.redirect('/admin/requests/' + id);
  }
  setRequestStatus(id, to, req.user.id, clip(req.body.note, 500));
  if (req.body.draft_email) emails.draft('status_update', id, {}, req.user.id);
  flash(req, `Status updated to ${to}.` + (req.body.draft_email ? ' A status update email was drafted for your review.' : ''));
  res.redirect('/admin/requests/' + id);
});

router.post('/requests/:id/notes', (req, res) => {
  const body = clip(req.body.body, 5000);
  if (body) run('INSERT INTO request_notes (request_id, author_id, body) VALUES (?,?,?)', Number(req.params.id), req.user.id, body);
  res.redirect('/admin/requests/' + req.params.id + '#notes');
});

router.post('/requests/:id/research', async (req, res) => {
  const runId = await research.startRun(Number(req.params.id), req.user.id, clip(req.body.instructions, 3000));
  res.redirect('/admin/research/' + runId);
});

// Add an option you researched yourself (agent portal, supplier phone call, etc.)
router.get('/requests/:id/manual-result', (req, res, next) => {
  const r = loadRequest(Number(req.params.id));
  if (!r) return next();
  res.render('admin/manual-result', { title: 'Add researched option', r, providers: all('SELECT id, name FROM providers ORDER BY name') });
});
router.post('/requests/:id/manual-result', (req, res) => {
  const id = Number(req.params.id);
  const b = req.body;
  const r = one('SELECT * FROM travel_requests WHERE id=?', id);
  const pax = (r.adults || 0) + (r.children || 0) || 1;
  const type = ['package', 'flight', 'hotel', 'activity'].includes(b.result_type) ? b.result_type : 'package';
  const total = num(b.price_total);
  const bool = k => Boolean(b[k]);
  const hotel = { name: clip(b.hotel_name, 200), stars: num(b.stars), guest_rating: num(b.guest_rating), room_type: clip(b.room_type, 200),
    all_inclusive: bool('all_inclusive'), adults_only: bool('adults_only'), family_friendly: bool('family_friendly'), beachfront: bool('beachfront'),
    nightly_rate: num(b.nightly_rate), nights: num(b.nights), rooms: r.rooms, taxes: num(b.taxes), resort_fees: num(b.resort_fees),
    room_total: num(b.room_total), transfer_estimate: num(b.transfer_estimate), cancellation: clip(b.cancellation, 300), amenities: (b.amenities || '').split(/\r?\n|,/).map(s => s.trim()).filter(Boolean) };
  const flight = { airline: clip(b.airline, 120), stops: num(b.stops), duration: clip(b.duration, 40), outbound: clip(b.outbound, 200), inbound: clip(b.inbound, 200),
    fare_pp: num(b.fare_pp), baggage_fee_pp: num(b.baggage_fee_pp), seat_fee_pp: num(b.seat_fee_pp), cancellation: clip(b.flight_cancellation, 300), change_policy: clip(b.change_policy, 300) };
  let data;
  if (type === 'package') data = { provider: clip(b.provider_name, 200), flight, hotel, transfers_included: bool('transfers_included'), nights: hotel.nights,
    inclusions: (b.inclusions || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean), exclusions: (b.exclusions || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean) };
  else if (type === 'flight') data = flight;
  else if (type === 'hotel') data = { ...hotel, total };
  else data = { name: clip(b.title, 200), description: clip(b.notes, 1000), price_pp: num(b.activity_pp), duration: clip(b.duration, 40), tags: [] };
  const finalTotal = type === 'flight' && !total && flight.fare_pp ? flight.fare_pp * pax : total;
  run(`INSERT INTO research_results (request_id, provider_id, provider_name, result_type, title, data, price_total, price_per_person, currency, source_url, retrieved_at, availability_status, is_sample, entered_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,'agent_user')`, id, num(b.provider_id), clip(b.provider_name, 200), type, clip(b.title, 200) || `${type} option`,
    JSON.stringify(data), finalTotal, finalTotal ? Math.round(finalTotal / pax) : null, clip(b.currency, 3) || 'USD', clip(b.source_url, 1000),
    b.retrieved_at ? new Date(b.retrieved_at).toISOString() : now(), clip(b.availability_status, 100) || 'Available when checked');
  flash(req, 'Option saved. Run research again to include it in the comparison and recommendations.');
  res.redirect('/admin/requests/' + id + '#research');
});

// ---------- research ----------
router.get('/research', (req, res) => {
  const list = all(`SELECT rr.*, t.ref_code, t.destination, c.name customer_name FROM research_runs rr JOIN travel_requests t ON t.id=rr.request_id
    JOIN customers c ON c.id=t.customer_id ORDER BY rr.id DESC LIMIT 200`);
  const queue = all(`SELECT t.*, c.name customer_name FROM travel_requests t JOIN customers c ON c.id=t.customer_id
    WHERE t.status IN ('New Inquiry','Research Pending','Awaiting Agent Review') ORDER BY t.created_at`);
  res.render('admin/research-list', { title: 'AI Travel Research', list, queue });
});
router.get('/research/:id/status.json', (req, res) => {
  const r = one('SELECT status, progress, log FROM research_runs WHERE id=?', Number(req.params.id));
  if (!r) return res.status(404).json({});
  res.json({ status: r.status, progress: r.progress, log: json(r.log, []) });
});
router.get('/research/:id', (req, res, next) => {
  const runRow = one('SELECT * FROM research_runs WHERE id=?', Number(req.params.id));
  if (!runRow) return next();
  const r = loadRequest(runRow.request_id);
  const report = json(runRow.report, null);
  const results = all('SELECT * FROM research_results WHERE run_id=? OR (request_id=? AND entered_by=\'agent_user\') ORDER BY result_type, price_total', runRow.id, r.id)
    .map(x => ({ ...x, data: json(x.data, {}) }));
  const grouped = { option: [], package: [], flight: [], hotel: [], activity: [] };
  for (const x of results) (grouped[x.result_type] = grouped[x.result_type] || []).push(x);
  grouped.option.sort((a, b) => (b.data.score?.total || 0) - (a.data.score?.total || 0));
  const converted = new Set(all('SELECT source_result_id FROM packages WHERE request_id=?', r.id).map(x => x.source_result_id));
  res.render('admin/research', { title: `Research report · ${r.ref_code}`, run: runRow, r, report, grouped, log: json(runRow.log, []),
    providers: json(runRow.providers_searched, []), reqs: json(runRow.requirements, null), converted });
});
router.post('/research/:id/decision', (req, res) => {
  const d = ['Approved', 'Rejected', 'Needs more research'].includes(req.body.decision) ? req.body.decision : 'Pending review';
  run('UPDATE research_runs SET decision=?, review_notes=? WHERE id=?', d, clip(req.body.review_notes, 3000), Number(req.params.id));
  flash(req, 'Report marked ' + d + '.');
  res.redirect('/admin/research/' + req.params.id);
});
router.post('/results/:id/review', (req, res) => {
  const x = one('SELECT * FROM research_results WHERE id=?', Number(req.params.id));
  const s = ['Approved', 'Rejected', 'Pending'].includes(req.body.review_status) ? req.body.review_status : 'Pending';
  run('UPDATE research_results SET review_status=? WHERE id=?', s, x.id);
  res.redirect(req.get('referer') && req.get('referer').includes('/admin/') ? req.get('referer') : '/admin/requests/' + x.request_id);
});
// Turn an AI option into an editable package for this customer.
router.post('/results/:id/to-package', (req, res) => {
  const x = one('SELECT * FROM research_results WHERE id=?', Number(req.params.id));
  const r = one('SELECT * FROM travel_requests WHERE id=?', x.request_id);
  const o = json(x.data, {});
  const f = o.flight || {}, h = o.hotel || {};
  const pax = (r.adults || 0) + (r.children || 0) || 1;
  const destMatch = destinations.find(d => (r.destination || '').toLowerCase().includes(d.name.toLowerCase().split(',')[0]));
  const cat = req.body.category || 'standard';
  const flightTxt = [f.airline, f.route, f.stops != null ? (f.stops === 0 ? 'Nonstop' : f.stops + ' stop' + (f.stops > 1 ? 's' : '')) : null, f.duration, f.outbound, f.cabin].filter(Boolean).join(' · ');
  const hotelTxt = [h.stars ? h.stars + ' star' : null, h.guest_rating ? 'Guest rating ' + h.guest_rating + '/10' : null, h.all_inclusive ? 'All-inclusive' : null,
    h.adults_only ? 'Adults-only' : null, h.beachfront ? 'Beachfront' : null, (h.amenities || []).join(', ')].filter(Boolean).join(' · ');
  const ins = run(`INSERT INTO packages (customer_id, request_id, destination_slug, destination_name, name, category, provider, summary, hotel_name, hotel_details, room_type,
    flight_details, transportation, inclusions, exclusions, start_date, end_date, nights, travelers, estimated_price_pp, estimated_total, price_type, pricing_source,
    booking_source, booking_url, pricing_checked_at, images, is_sample, is_public, status, source_result_id, supplier_notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'Draft',?,?)`,
    r.customer_id, r.id, destMatch ? destMatch.slug : null, r.destination, `${r.destination || 'Vacation'}: ${h.name || o.title}`, cat, o.provider,
    `${o.kind || 'Option'} with ${h.name || 'hotel'}${f.airline ? ' and ' + f.airline : ''}.`, h.name, hotelTxt, h.room_type, flightTxt,
    (o.inclusions || []).find(i => /transfer/i.test(i)) || ((o.costs || []).some(c => /transfer/i.test(c.label)) ? 'Airport transfers (estimated, arrange separately)' : null),
    (o.inclusions || []).join('\n'), (o.exclusions || []).join('\n'), r.depart_date, r.return_date, h.nights || null, pax,
    o.per_person || x.price_per_person, o.total || x.price_total, 'Estimated', (o.sources || []).map(s => s.provider).join(' + '),
    o.kind, (o.sources || []).map(s => s.url).find(Boolean) || null, x.retrieved_at, JSON.stringify(destMatch ? [destMatch.image] : []),
    x.is_sample ? 1 : 0, x.id, `Built from research option #${x.id}. Cost breakdown: ` + (o.costs || []).map(c => `${c.label} $${c.amount}`).join('; '));
  run("UPDATE research_results SET review_status='Approved' WHERE id=?", x.id);
  flash(req, 'Package created from the research option. Review the details and pricing before adding it to a proposal.');
  res.redirect(`/admin/packages/${ins.lastInsertRowid}/edit`);
});

// ---------- customers ----------
router.get('/customers', (req, res) => {
  const q = clip(req.query.q, 100);
  const list = q
    ? all(`SELECT c.*, (SELECT COUNT(*) FROM travel_requests t WHERE t.customer_id=c.id) trips FROM customers c WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY c.created_at DESC`, ...Array(3).fill('%' + q + '%'))
    : all(`SELECT c.*, (SELECT COUNT(*) FROM travel_requests t WHERE t.customer_id=c.id) trips FROM customers c ORDER BY c.created_at DESC LIMIT 300`);
  res.render('admin/customers', { title: 'Customers', list, q });
});
router.get('/customers/:id', (req, res, next) => {
  const c = one('SELECT * FROM customers WHERE id=?', Number(req.params.id));
  if (!c) return next();
  c.prefs = json(c.preferences, {});
  const requests = all('SELECT * FROM travel_requests WHERE customer_id=? ORDER BY id DESC', c.id);
  const bookings = all('SELECT b.*, t.destination, t.ref_code FROM bookings b JOIN travel_requests t ON t.id=b.request_id WHERE b.customer_id=? ORDER BY b.id DESC', c.id);
  const comms = all('SELECT * FROM communications WHERE customer_id=? ORDER BY id DESC LIMIT 50', c.id);
  const selections = all(`SELECT p.selected_at, pi.snapshot, pi.customer_total, t.ref_code FROM proposals p JOIN proposal_items pi ON pi.id=p.selected_item_id
    JOIN travel_requests t ON t.id=p.request_id WHERE p.customer_id=? ORDER BY p.selected_at DESC`, c.id).map(s => ({ ...s, pkg: json(s.snapshot, {}) }));
  res.render('admin/customer', { title: c.name, c, requests, bookings, comms, selections });
});
router.post('/customers/:id', (req, res) => {
  const b = req.body;
  run("UPDATE customers SET name=?, email=?, phone=?, internal_notes=?, updated_at=datetime('now') WHERE id=?",
    clip(b.name, 120), clip(b.email, 200), clip(b.phone, 40), clip(b.internal_notes), Number(req.params.id));
  flash(req, 'Customer saved.');
  res.redirect('/admin/customers/' + req.params.id);
});

// ---------- packages ----------
router.get('/packages', (req, res) => {
  const scope = req.query.scope || 'all';
  let where = '1=1';
  if (scope === 'public') where = 'p.is_public=1';
  if (scope === 'custom') where = 'p.is_public=0';
  const list = all(`SELECT p.*, c.name customer_name, t.ref_code FROM packages p LEFT JOIN customers c ON c.id=p.customer_id LEFT JOIN travel_requests t ON t.id=p.request_id WHERE ${where} ORDER BY p.updated_at DESC`);
  res.render('admin/packages', { title: 'Packages', list, scope });
});
router.get('/packages/new', (req, res) => {
  const r = req.query.request ? one('SELECT * FROM travel_requests WHERE id=?', Number(req.query.request)) : null;
  const p = { category: 'standard', status: 'Draft', price_type: 'Estimated', is_public: r ? 0 : 1, images: [], request_id: r ? r.id : null,
    customer_id: r ? r.customer_id : null, start_date: r ? r.depart_date : null, end_date: r ? r.return_date : null,
    travelers: r ? (r.adults || 0) + (r.children || 0) : 2, destination_name: r ? r.destination : '' };
  res.render('admin/package-form', { title: 'New package', p, destinations });
});
router.get('/packages/:id/edit', (req, res, next) => {
  const p = one('SELECT * FROM packages WHERE id=?', Number(req.params.id));
  if (!p) return next();
  p.images = json(p.images, []);
  res.render('admin/package-form', { title: 'Edit package', p, destinations });
});

function savePackage(req, id) {
  const b = req.body;
  const existing = id ? one('SELECT * FROM packages WHERE id=?', id) : null;
  let images = existing ? json(existing.images, []) : [];
  const remove = [].concat(b.remove_image || []);
  images = images.filter(i => !remove.includes(i));
  if (clip(b.image_url, 1000) && /^https:\/\//.test(b.image_url)) images.push(b.image_url.trim());
  for (const f of req.files || []) images.push('/uploads/' + f.filename);
  const d = bySlug[b.destination_slug];
  const travelers = num(b.travelers) || 2;
  const total = num(b.estimated_total) ?? (num(b.estimated_price_pp) != null ? num(b.estimated_price_pp) * travelers : null);
  const pp = num(b.estimated_price_pp) ?? (total != null ? Math.round(total / travelers) : null);
  let isSample = existing ? existing.is_sample : 0;
  let priceType = ['Estimated', 'Quoted', 'Sample'].includes(b.price_type) ? b.price_type : 'Estimated';
  let checked = clip(b.pricing_checked_at, 40) || (existing && existing.pricing_checked_at) || null;
  if (b.verified_now) { isSample = 0; checked = now(); if (priceType === 'Sample') priceType = 'Quoted'; }
  if (isSample) priceType = 'Sample';
  const vals = [b.destination_slug || null, clip(b.destination_name, 120) || (d && d.name) || null, clip(b.name, 200) || 'Untitled package',
    C.PACKAGE_CATEGORIES[b.category] ? b.category : 'standard', clip(b.provider, 200), clip(b.summary, 600), clip(b.description), clip(b.hotel_name, 200),
    clip(b.hotel_details), clip(b.room_type, 200), clip(b.flight_details), clip(b.transportation), clip(b.activities), clip(b.dining), clip(b.inclusions), clip(b.exclusions),
    clip(b.start_date, 10), clip(b.end_date, 10), num(b.nights), travelers, pp, total, priceType, clip(b.pricing_source, 300), clip(b.booking_source, 200),
    clip(b.booking_url, 1000), checked, JSON.stringify(images), isSample, b.is_public ? 1 : 0,
    ['Draft', 'Active', 'Inactive'].includes(b.status) ? b.status : 'Draft', clip(b.supplier_notes)];
  if (existing) {
    run(`UPDATE packages SET destination_slug=?, destination_name=?, name=?, category=?, provider=?, summary=?, description=?, hotel_name=?, hotel_details=?, room_type=?,
      flight_details=?, transportation=?, activities=?, dining=?, inclusions=?, exclusions=?, start_date=?, end_date=?, nights=?, travelers=?, estimated_price_pp=?,
      estimated_total=?, price_type=?, pricing_source=?, booking_source=?, booking_url=?, pricing_checked_at=?, images=?, is_sample=?, is_public=?, status=?, supplier_notes=?,
      updated_at=datetime('now') WHERE id=?`, ...vals, id);
    return id;
  }
  const r = run(`INSERT INTO packages (destination_slug, destination_name, name, category, provider, summary, description, hotel_name, hotel_details, room_type,
    flight_details, transportation, activities, dining, inclusions, exclusions, start_date, end_date, nights, travelers, estimated_price_pp, estimated_total,
    price_type, pricing_source, booking_source, booking_url, pricing_checked_at, images, is_sample, is_public, status, supplier_notes, request_id, customer_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...vals, num(b.request_id), num(b.customer_id));
  return Number(r.lastInsertRowid);
}
router.post('/packages', imageUpload.array('images', 8), verifyCsrf, (req, res) => {
  const id = savePackage(req, null);
  flash(req, 'Package created.');
  res.redirect(`/admin/packages/${id}/edit`);
});
router.post('/packages/:id', imageUpload.array('images', 8), verifyCsrf, (req, res) => {
  savePackage(req, Number(req.params.id));
  flash(req, 'Package saved.');
  res.redirect(`/admin/packages/${req.params.id}/edit`);
});
router.post('/packages/:id/toggle', (req, res) => {
  const p = one('SELECT status FROM packages WHERE id=?', Number(req.params.id));
  run("UPDATE packages SET status=?, updated_at=datetime('now') WHERE id=?", p.status === 'Active' ? 'Inactive' : 'Active', Number(req.params.id));
  res.redirect(req.get('referer') || '/admin/packages');
});

// ---------- proposals ----------
router.get('/proposals', (req, res) => {
  const list = all(`SELECT p.*, c.name customer_name, t.ref_code, t.destination, (SELECT COUNT(*) FROM proposal_items i WHERE i.proposal_id=p.id) items
    FROM proposals p JOIN customers c ON c.id=p.customer_id JOIN travel_requests t ON t.id=p.request_id ORDER BY p.id DESC`);
  res.render('admin/proposals', { title: 'Proposals', list });
});
router.post('/requests/:id/proposals', (req, res) => {
  const r = one('SELECT * FROM travel_requests WHERE id=?', Number(req.params.id));
  const c = one('SELECT name FROM customers WHERE id=?', r.customer_id);
  const ids = [].concat(req.body.package_ids || []).map(Number).filter(Boolean);
  if (!ids.length) { flash(req, 'Select at least one package to include in the proposal.', 'error'); return res.redirect('/admin/requests/' + r.id + '#packages'); }
  const pid = tx(() => {
    const ins = run('INSERT INTO proposals (request_id, customer_id, token, title, intro, deposit_info) VALUES (?,?,?,?,?,?)', r.id, r.customer_id, token(),
      `${r.destination || 'Your'} vacation proposal for ${c.name}`,
      `Thank you for letting me plan your trip. Based on everything you shared, here are the options I recommend. Each one was hand picked and checked against your budget and preferences.`,
      'A deposit is only requested after I confirm availability and final pricing with the supplier.');
    const p = Number(ins.lastInsertRowid);
    ids.forEach((pkId, i) => {
      const pk = one('SELECT * FROM packages WHERE id=?', pkId);
      if (pk) run('INSERT INTO proposal_items (proposal_id, package_id, sort, base_total, customer_total, customer_pp, recommended) VALUES (?,?,?,?,?,?,?)',
        p, pk.id, i, pk.estimated_total, pk.estimated_total, pk.estimated_price_pp, i === 0 ? 1 : 0);
    });
    return p;
  });
  res.redirect('/admin/proposals/' + pid);
});
function loadAdminProposal(id) {
  const p = one('SELECT * FROM proposals WHERE id=?', id);
  if (!p) return null;
  p.request = one('SELECT * FROM travel_requests WHERE id=?', p.request_id);
  p.customer = one('SELECT * FROM customers WHERE id=?', p.customer_id);
  p.items = all('SELECT i.*, k.name pkg_name, k.is_sample, k.price_type, k.estimated_total, k.travelers, k.pricing_checked_at pkg_checked, k.supplier_notes FROM proposal_items i JOIN packages k ON k.id=i.package_id WHERE proposal_id=? ORDER BY sort, i.id', id);
  return p;
}
router.get('/proposals/:id', (req, res, next) => {
  const p = loadAdminProposal(Number(req.params.id));
  if (!p) return next();
  const available = all('SELECT id, name, estimated_total, is_sample, is_public FROM packages WHERE (request_id=? OR (is_public=1 AND status=\'Active\')) AND id NOT IN (SELECT package_id FROM proposal_items WHERE proposal_id=?) ORDER BY request_id DESC, id DESC', p.request_id, p.id);
  res.render('admin/proposal', { title: 'Proposal builder', p, available });
});
router.post('/proposals/:id', (req, res) => {
  const id = Number(req.params.id);
  const p = loadAdminProposal(id);
  const b = req.body;
  tx(() => {
    run('UPDATE proposals SET title=?, intro=?, closing_note=?, deposit_info=?, valid_until=? WHERE id=?', clip(b.title, 200), clip(b.intro), clip(b.closing_note), clip(b.deposit_info), clip(b.valid_until, 10), id);
    for (const it of p.items) {
      const k = `item_${it.id}_`;
      if (b[k + 'remove']) { run('DELETE FROM proposal_items WHERE id=?', it.id); continue; }
      const base = num(b[k + 'base_total']) ?? it.estimated_total ?? 0;
      const fee = num(b[k + 'service_fee']) || 0;
      const markup = num(b[k + 'markup_pct']) || 0;
      const override = num(b[k + 'customer_total']);
      const computed = Math.round((base * (1 + markup / 100) + fee) * 100) / 100;
      const total = b[k + 'use_override'] && override != null ? override : computed;
      const pax = it.travelers || 1;
      run('UPDATE proposal_items SET sort=?, recommended=?, headline=?, agent_note=?, base_total=?, service_fee=?, markup_pct=?, customer_total=?, customer_pp=?, include_link=? WHERE id=?',
        num(b[k + 'sort']) || 0, b.recommended == it.id ? 1 : 0, clip(b[k + 'headline'], 200), clip(b[k + 'agent_note'], 2000), base, fee, markup, total, Math.round(total / pax),
        b[k + 'include_link'] ? 1 : 0, it.id);
    }
    if (b.add_package_id) {
      const pk = one('SELECT * FROM packages WHERE id=?', Number(b.add_package_id));
      if (pk) run('INSERT INTO proposal_items (proposal_id, package_id, sort, base_total, customer_total, customer_pp) VALUES (?,?,?,?,?,?)', id, pk.id, 99, pk.estimated_total, pk.estimated_total, pk.estimated_price_pp);
    }
  });
  flash(req, 'Proposal saved.');
  res.redirect('/admin/proposals/' + id);
});

// Freeze what the customer sees at send time (original quoted price is preserved).
function snapshot(pk, item) {
  return JSON.stringify({
    name: pk.name, category: pk.category, destination: pk.destination_name, destination_slug: pk.destination_slug, provider: pk.provider,
    summary: pk.summary, description: pk.description, hotel_name: pk.hotel_name, hotel_details: pk.hotel_details, room_type: pk.room_type,
    flight_details: pk.flight_details, transportation: pk.transportation, activities: pk.activities, dining: pk.dining,
    inclusions: pk.inclusions, exclusions: pk.exclusions, start_date: pk.start_date, end_date: pk.end_date, nights: pk.nights, travelers: pk.travelers,
    images: json(pk.images, []), booking_source: pk.booking_source, booking_url: item.include_link ? pk.booking_url : null,
    price_type: 'Quoted', pricing_checked_at: pk.pricing_checked_at
  });
}
router.get('/proposals/:id/preview', (req, res, next) => {
  const p = loadAdminProposal(Number(req.params.id));
  if (!p) return next();
  const view = { ...p, customer: { name: p.customer.name }, items: p.items.map(i => ({ ...i, pkg: json(snapshot(one('SELECT * FROM packages WHERE id=?', i.package_id), i)) })) };
  res.render('public/proposal', { title: 'Preview', p: view, preview: true, justSelected: false });
});
router.post('/proposals/:id/send', (req, res) => {
  const id = Number(req.params.id);
  const p = loadAdminProposal(id);
  if (!p.items.length) { flash(req, 'Add at least one package first.', 'error'); return res.redirect('/admin/proposals/' + id); }
  if (p.items.some(i => i.is_sample)) {
    flash(req, 'This proposal includes sample data packages. Verify real pricing with the supplier and mark each package as verified before sending.', 'error');
    return res.redirect('/admin/proposals/' + id);
  }
  tx(() => {
    for (const it of p.items) {
      const pk = one('SELECT * FROM packages WHERE id=?', it.package_id);
      run('UPDATE proposal_items SET snapshot=?, pricing_checked_at=? WHERE id=?', snapshot(pk, it), pk.pricing_checked_at, it.id);
      run("UPDATE packages SET status=CASE WHEN is_public=1 THEN status ELSE 'Active' END, price_type='Quoted' WHERE id=? AND is_public=0", pk.id);
    }
    run("UPDATE proposals SET status='Sent', sent_at=datetime('now') WHERE id=?", id);
    setRequestStatus(p.request_id, 'Quote Sent', req.user.id, `Proposal #${id} published`);
    setRequestStatus(p.request_id, 'Awaiting Customer Selection', req.user.id, 'Waiting for the customer to choose');
  });
  const commId = emails.draft('proposal', p.request_id, { proposal: p }, req.user.id);
  flash(req, 'Proposal published. Review the drafted email, then approve and send it.');
  res.redirect('/admin/communications/' + commId);
});

// ---------- bookings (human operated) ----------
router.get('/bookings', (req, res) => {
  const list = all(`SELECT b.*, c.name customer_name, t.ref_code, t.destination FROM bookings b JOIN customers c ON c.id=b.customer_id JOIN travel_requests t ON t.id=b.request_id ORDER BY b.updated_at DESC`);
  res.render('admin/bookings', { title: 'Bookings', list });
});
router.post('/requests/:id/bookings', (req, res) => {
  const id = Number(req.params.id);
  const r = one('SELECT * FROM travel_requests WHERE id=?', id);
  const sel = one(`SELECT pi.*, p.selected_at FROM proposals p JOIN proposal_items pi ON pi.id=p.selected_item_id WHERE p.request_id=? AND p.status='Selected' ORDER BY p.selected_at DESC LIMIT 1`, id);
  const snap = sel ? json(sel.snapshot, {}) : {};
  const ins = run(`INSERT INTO bookings (request_id, customer_id, proposal_item_id, package_snapshot, quoted_total, quoted_at, travel_start, travel_end, hotel_info, flight_info, supplier)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, r.customer_id, sel ? sel.id : null, sel ? sel.snapshot : null, sel ? sel.customer_total : null, sel ? sel.pricing_checked_at : null,
    snap.start_date || r.depart_date, snap.end_date || r.return_date, [snap.hotel_name, snap.room_type].filter(Boolean).join(', ') || null, snap.flight_details || null, snap.provider || null);
  setRequestStatus(id, 'Booking in Progress', req.user.id, 'Agent started the booking');
  flash(req, 'Booking record created. Complete the reservation with the supplier yourself, then record the confirmation here.');
  res.redirect('/admin/bookings/' + ins.lastInsertRowid);
});
router.get('/bookings/:id', (req, res, next) => {
  const b = one(`SELECT b.*, c.name customer_name, c.email customer_email, c.phone customer_phone, t.ref_code, t.destination FROM bookings b
    JOIN customers c ON c.id=b.customer_id JOIN travel_requests t ON t.id=b.request_id WHERE b.id=?`, Number(req.params.id));
  if (!b) return next();
  b.pkg = json(b.package_snapshot, null);
  const docs = all('SELECT * FROM booking_documents WHERE booking_id=? ORDER BY id DESC', b.id);
  const payments = all('SELECT * FROM payments WHERE booking_id=? ORDER BY id DESC', b.id);
  res.render('admin/booking', { title: 'Booking · ' + b.ref_code, b, docs, payments });
});
router.post('/bookings/:id', docUpload.array('documents', 5), verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const x = req.body;
  run(`UPDATE bookings SET supplier=?, booking_portal=?, final_price=?, confirmation_number=?, booking_date=?, travel_start=?, travel_end=?, hotel_info=?, flight_info=?,
    payment_status=?, customer_notes=?, internal_notes=?, updated_at=datetime('now') WHERE id=?`,
    clip(x.supplier, 200), clip(x.booking_portal, 300), num(x.final_price), clip(x.confirmation_number, 100), clip(x.booking_date, 10), clip(x.travel_start, 10),
    clip(x.travel_end, 10), clip(x.hotel_info), clip(x.flight_info), C.PAYMENT_STATUSES.includes(x.payment_status) ? x.payment_status : 'Not requested',
    clip(x.customer_notes), clip(x.internal_notes), id);
  for (const f of req.files || []) run('INSERT INTO booking_documents (booking_id, stored_name, original_name, uploaded_by) VALUES (?,?,?,?)', id, f.filename, f.originalname.slice(0, 200), req.user.id);
  flash(req, 'Booking details saved.');
  res.redirect('/admin/bookings/' + id);
});
router.post('/bookings/:id/confirm', (req, res) => {
  const id = Number(req.params.id);
  const b = one('SELECT * FROM bookings WHERE id=?', id);
  if (!b.confirmation_number || !b.supplier || b.final_price == null || !req.body.attest) {
    flash(req, 'To confirm, first save the supplier, final confirmed price and confirmation number, and tick the box confirming you completed the reservation.', 'error');
    return res.redirect('/admin/bookings/' + id);
  }
  tx(() => {
    run("UPDATE bookings SET booking_status='Confirmed', booking_date=COALESCE(booking_date, date('now')), updated_at=datetime('now') WHERE id=?", id);
    setRequestStatus(b.request_id, 'Confirmed', req.user.id, `Confirmed with ${b.supplier}, confirmation ${b.confirmation_number}`);
  });
  const commId = emails.draft('booking_confirmation', b.request_id, { booking: one('SELECT * FROM bookings WHERE id=?', id) }, req.user.id);
  flash(req, 'Reservation marked Confirmed. A confirmation email was drafted for your review.');
  res.redirect('/admin/communications/' + commId);
});
router.post('/bookings/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const b = one('SELECT * FROM bookings WHERE id=?', id);
  const s = req.body.booking_status;
  if (s === 'Completed' && b.booking_status === 'Confirmed') { run("UPDATE bookings SET booking_status='Completed' WHERE id=?", id); setRequestStatus(b.request_id, 'Completed', req.user.id); }
  if (s === 'Cancelled') { run("UPDATE bookings SET booking_status='Cancelled' WHERE id=?", id); setRequestStatus(b.request_id, 'Cancelled', req.user.id, clip(req.body.note, 500)); }
  res.redirect('/admin/bookings/' + id);
});
router.post('/bookings/:id/payments', (req, res) => {
  const id = Number(req.params.id);
  const b = one('SELECT * FROM bookings WHERE id=?', id);
  if (!['Confirmed', 'Completed', 'Cancelled'].includes(b.booking_status)) {
    flash(req, 'Payments can only be recorded for confirmed reservations (refunds for cancelled ones).', 'error');
    return res.redirect('/admin/bookings/' + id);
  }
  const amt = num(req.body.amount);
  if (amt) run('INSERT INTO payments (booking_id, kind, amount, method_note, paid_on, recorded_by) VALUES (?,?,?,?,?,?)',
    id, ['Deposit', 'Balance', 'Payment', 'Refund'].includes(req.body.kind) ? req.body.kind : 'Payment', amt, clip(req.body.method_note, 200), clip(req.body.paid_on, 10), req.user.id);
  res.redirect('/admin/bookings/' + id + '#payments');
});
router.get('/bookings/:id/docs/:docId', (req, res, next) => {
  const d = one('SELECT * FROM booking_documents WHERE id=? AND booking_id=?', Number(req.params.docId), Number(req.params.id));
  if (!d) return next();
  res.download(path.join(config.privateDocDir, path.basename(d.stored_name)), d.original_name);
});

// ---------- communications ----------
router.get('/communications', (req, res) => {
  const status = req.query.status || '';
  const list = all(`SELECT m.*, c.name customer_name, t.ref_code FROM communications m LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN travel_requests t ON t.id=m.request_id
    ${status ? 'WHERE m.status=?' : ''} ORDER BY m.id DESC LIMIT 300`, ...(status ? [status] : []));
  res.render('admin/communications', { title: 'Communications', list, status });
});
router.post('/requests/:id/communications', (req, res) => {
  const id = Number(req.params.id);
  if (req.body.direction === 'Log') {
    const r = one('SELECT customer_id FROM travel_requests WHERE id=?', id);
    run("INSERT INTO communications (request_id, customer_id, direction, subject, body, status, created_by) VALUES (?,?,?,?,?, 'Logged', ?)",
      id, r.customer_id, clip(req.body.channel, 40) || 'Note', clip(req.body.subject, 200), clip(req.body.body), req.user.id);
    return res.redirect('/admin/requests/' + id + '#comms');
  }
  const proposal = one('SELECT * FROM proposals WHERE request_id=? ORDER BY id DESC LIMIT 1', id);
  const booking = one('SELECT * FROM bookings WHERE request_id=? ORDER BY id DESC LIMIT 1', id);
  const t = C.EMAIL_TEMPLATES[req.body.template] ? req.body.template : 'status_update';
  if (t === 'proposal' && !proposal) { flash(req, 'Create a proposal first.', 'error'); return res.redirect('/admin/requests/' + id); }
  const commId = emails.draft(t, id, { proposal, booking }, req.user.id);
  res.redirect('/admin/communications/' + commId);
});
router.get('/communications/:id', (req, res, next) => {
  const m = one(`SELECT m.*, c.name customer_name, t.ref_code FROM communications m LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN travel_requests t ON t.id=m.request_id WHERE m.id=?`, Number(req.params.id));
  if (!m) return next();
  res.render('admin/communication', { title: 'Email', m });
});
router.post('/communications/:id', (req, res) => {
  const id = Number(req.params.id);
  const m = one('SELECT * FROM communications WHERE id=?', id);
  const action = req.body.action;
  if (m.status === 'Draft' || m.status === 'Approved') {
    run('UPDATE communications SET to_email=?, subject=?, body=? WHERE id=?', clip(req.body.to_email, 200), clip(req.body.subject, 300), clip(req.body.body, 20000), id);
  }
  if (action === 'approve') run("UPDATE communications SET status='Approved', approved_by=?, approved_at=datetime('now') WHERE id=?", req.user.id, id);
  if (action === 'sent') run("UPDATE communications SET status='Sent', sent_at=datetime('now'), approved_by=COALESCE(approved_by, ?), approved_at=COALESCE(approved_at, datetime('now')) WHERE id=?", req.user.id, id);
  if (action === 'discard') run("UPDATE communications SET status='Discarded' WHERE id=?", id);
  flash(req, action === 'sent' ? 'Marked as sent.' : action === 'approve' ? 'Approved.' : action === 'discard' ? 'Draft discarded.' : 'Saved.');
  res.redirect('/admin/communications/' + id);
});

// ---------- messages ----------
router.get('/messages', (req, res) => res.render('admin/messages', { title: 'Contact messages', list: all('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 300') }));
router.post('/messages/:id/handled', (req, res) => { run('UPDATE contact_messages SET handled=1-handled WHERE id=?', Number(req.params.id)); res.redirect('/admin/messages'); });

// ---------- providers ----------
router.get('/providers', (req, res) => {
  const { adapters } = require('../research/providers');
  res.render('admin/providers', { title: 'Travel providers', list: all('SELECT * FROM providers ORDER BY type, name'), adapters });
});
router.post('/providers', requireOwner, (req, res) => {
  const b = req.body;
  const vals = [clip(b.name, 200), C.PROVIDER_TYPES[b.type] ? b.type : 'online_package', clip(b.website, 500), clip(b.booking_url, 500), clip(b.adapter_key, 40) || 'manual',
    clip(b.integration_status, 100) || 'Manual research', clip(b.api_available, 200), clip(b.partner_status, 200) || 'No relationship established', clip(b.notes, 2000), b.active ? 1 : 0];
  if (b.id) run('UPDATE providers SET name=?, type=?, website=?, booking_url=?, adapter_key=?, integration_status=?, api_available=?, partner_status=?, notes=?, active=? WHERE id=?', ...vals, Number(b.id));
  else if (vals[0]) run('INSERT INTO providers (name, type, website, booking_url, adapter_key, integration_status, api_available, partner_status, notes, active) VALUES (?,?,?,?,?,?,?,?,?,?)', ...vals);
  flash(req, 'Provider saved.');
  res.redirect('/admin/providers');
});

// ---------- users ----------
router.get('/users', requireOwner, (req, res) => res.render('admin/users', { title: 'Team', list: all('SELECT id, name, email, role, active, created_at FROM users ORDER BY id'), error: null }));
router.post('/users', requireOwner, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!clip(name) || !/^\S+@\S+\.\S+$/.test(email || '') || (password || '').length < 10 || one('SELECT id FROM users WHERE lower(email)=?', email.toLowerCase())) {
    return res.status(400).render('admin/users', { title: 'Team', list: all('SELECT id, name, email, role, active, created_at FROM users ORDER BY id'), error: 'Enter a name, an unused email and a password of at least 10 characters.' });
  }
  run('INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,?)', clip(name, 120), email.trim().toLowerCase(), bcrypt.hashSync(password, 12), role === 'owner' ? 'owner' : 'staff');
  flash(req, 'Team member added.');
  res.redirect('/admin/users');
});
router.post('/users/:id/toggle', requireOwner, (req, res) => {
  if (Number(req.params.id) !== req.user.id) run('UPDATE users SET active=1-active WHERE id=?', Number(req.params.id));
  res.redirect('/admin/users');
});
router.post('/account/password', (req, res) => {
  const u = one('SELECT * FROM users WHERE id=?', req.user.id);
  if (!bcrypt.compareSync(String(req.body.current || ''), u.password_hash) || String(req.body.password || '').length < 10) {
    flash(req, 'Current password was wrong or the new one is shorter than 10 characters.', 'error');
  } else { run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(req.body.password, 12), u.id); flash(req, 'Password changed.'); }
  res.redirect('/admin/account');
});
router.get('/account', (req, res) => res.render('admin/account', { title: 'My account' }));

module.exports = router;
