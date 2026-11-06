// SQLite database (built into Node 22.13+). One file: data/agency.db
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.privateDocDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, 'agency.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
  preferences TEXT, internal_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

CREATE TABLE IF NOT EXISTS travel_requests (
  id INTEGER PRIMARY KEY, ref_code TEXT NOT NULL UNIQUE, access_token TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  destination TEXT, destination_flexible INTEGER DEFAULT 0, departure_airport TEXT,
  depart_date TEXT, return_date TEXT, flexible_dates INTEGER DEFAULT 0,
  adults INTEGER DEFAULT 2, children INTEGER DEFAULT 0, rooms INTEGER DEFAULT 1,
  budget_per_person REAL, budget_total REAL, budget_flexible INTEGER DEFAULT 0,
  vacation_style TEXT, flight_pref TEXT, preferred_airline TEXT, departure_time_pref TEXT, baggage TEXT,
  hotel_prefs TEXT, experiences TEXT, special_requests TEXT, contact_pref TEXT,
  source TEXT, status TEXT NOT NULL DEFAULT 'New Inquiry', assigned_to INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS request_notes (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
  from_status TEXT, to_status TEXT NOT NULL, changed_by INTEGER REFERENCES users(id), note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, website TEXT, booking_url TEXT,
  adapter_key TEXT NOT NULL DEFAULT 'manual', integration_status TEXT NOT NULL DEFAULT 'Manual research',
  api_available TEXT DEFAULT 'Unknown', partner_status TEXT DEFAULT 'No relationship established',
  notes TEXT, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS research_runs (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', started_by INTEGER REFERENCES users(id), instructions TEXT,
  started_at TEXT, completed_at TEXT, progress INTEGER DEFAULT 0,
  providers_searched TEXT, log TEXT, requirements TEXT, report TEXT,
  decision TEXT NOT NULL DEFAULT 'Pending review', review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS research_results (
  id INTEGER PRIMARY KEY, run_id INTEGER REFERENCES research_runs(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id), provider_name TEXT,
  result_type TEXT NOT NULL, title TEXT NOT NULL, data TEXT,
  price_total REAL, price_per_person REAL, currency TEXT DEFAULT 'USD',
  source_url TEXT, retrieved_at TEXT, availability_status TEXT DEFAULT 'Unverified',
  is_sample INTEGER NOT NULL DEFAULT 0, entered_by TEXT DEFAULT 'agent',
  review_status TEXT NOT NULL DEFAULT 'Pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), request_id INTEGER REFERENCES travel_requests(id),
  destination_slug TEXT, destination_name TEXT, name TEXT NOT NULL, category TEXT DEFAULT 'standard',
  provider TEXT, summary TEXT, description TEXT,
  hotel_name TEXT, hotel_details TEXT, room_type TEXT, flight_details TEXT, transportation TEXT,
  activities TEXT, dining TEXT, inclusions TEXT, exclusions TEXT,
  start_date TEXT, end_date TEXT, nights INTEGER, travelers INTEGER,
  estimated_price_pp REAL, estimated_total REAL, price_type TEXT NOT NULL DEFAULT 'Estimated',
  pricing_source TEXT, booking_source TEXT, booking_url TEXT, pricing_checked_at TEXT,
  images TEXT, is_sample INTEGER NOT NULL DEFAULT 0, is_public INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft', source_result_id INTEGER REFERENCES research_results(id),
  supplier_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES travel_requests(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id), token TEXT NOT NULL UNIQUE,
  title TEXT, intro TEXT, closing_note TEXT, deposit_info TEXT, valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'Draft', selected_item_id INTEGER, selected_at TEXT, customer_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT
);
CREATE TABLE IF NOT EXISTS proposal_items (
  id INTEGER PRIMARY KEY, proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  package_id INTEGER NOT NULL REFERENCES packages(id), sort INTEGER DEFAULT 0, recommended INTEGER DEFAULT 0,
  headline TEXT, agent_note TEXT, base_total REAL, service_fee REAL DEFAULT 0, markup_pct REAL DEFAULT 0,
  customer_total REAL, customer_pp REAL, include_link INTEGER DEFAULT 0, snapshot TEXT, pricing_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES travel_requests(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id), proposal_item_id INTEGER REFERENCES proposal_items(id),
  package_snapshot TEXT, quoted_total REAL, quoted_at TEXT,
  supplier TEXT, booking_portal TEXT, final_price REAL, confirmation_number TEXT, booking_date TEXT,
  travel_start TEXT, travel_end TEXT, hotel_info TEXT, flight_info TEXT,
  payment_status TEXT NOT NULL DEFAULT 'Not requested', booking_status TEXT NOT NULL DEFAULT 'In Progress',
  customer_notes TEXT, internal_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS booking_documents (
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stored_name TEXT NOT NULL, original_name TEXT NOT NULL, uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, amount REAL NOT NULL, method_note TEXT, paid_on TEXT, recorded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS communications (
  id INTEGER PRIMARY KEY, request_id INTEGER REFERENCES travel_requests(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id), template TEXT, direction TEXT NOT NULL DEFAULT 'Outgoing',
  to_email TEXT, subject TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'Draft',
  created_by INTEGER REFERENCES users(id), approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), approved_at TEXT, sent_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, kind TEXT, message TEXT NOT NULL, link TEXT, is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, subject TEXT, message TEXT NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- helpers ----------
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);
const json = (v, fallback = null) => { if (v == null || v === '') return fallback; try { return JSON.parse(v); } catch { return fallback; } };
const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const refCode = () => 'TR-' + crypto.randomBytes(3).toString('hex').toUpperCase();
const now = () => new Date().toISOString();

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function notify(kind, message, link) {
  run('INSERT INTO notifications (kind, message, link) VALUES (?,?,?)', kind, message, link || null);
}

function setRequestStatus(requestId, toStatus, userId, note) {
  const r = one('SELECT status FROM travel_requests WHERE id=?', requestId);
  if (!r || r.status === toStatus) return;
  run("UPDATE travel_requests SET status=?, updated_at=datetime('now') WHERE id=?", toStatus, requestId);
  run('INSERT INTO status_history (request_id, from_status, to_status, changed_by, note) VALUES (?,?,?,?,?)',
    requestId, r.status, toStatus, userId || null, note || null);
}

// ---------- seed data ----------
function seed() {
  if (one('SELECT COUNT(*) c FROM providers').c === 0) {
    const P = (name, type, website, adapter, status, api, notes) =>
      run('INSERT INTO providers (name,type,website,booking_url,adapter_key,integration_status,api_available,notes) VALUES (?,?,?,?,?,?,?,?)',
        name, type, website, website, adapter, status, api, notes || null);
    // Demo data source so the research workflow can be tried end to end.
    P('Sample Data (demo only)', 'demo', '', 'sample', 'Active (demo data, not live)', 'Built in',
      'Generates clearly labeled sample results so you can test the workflow. Turn this off once real integrations are connected.');
    // Airline vacation package providers
    P('American Airlines Vacations', 'airline_vacations', 'https://www.aavacations.com', 'manual', 'Manual research', 'Agent portal / affiliate program: check eligibility');
    P('Delta Vacations', 'airline_vacations', 'https://www.delta.com/vacations', 'manual', 'Manual research', 'Travel advisor portal: check eligibility');
    P('United Vacations', 'airline_vacations', 'https://www.vacations.united.com', 'manual', 'Manual research', 'Travel advisor portal: check eligibility');
    P('Southwest Vacations', 'airline_vacations', 'https://www.southwestvacations.com', 'manual', 'Manual research', 'Travel advisor portal: check eligibility');
    // Online / package providers
    P('Expedia', 'online_package', 'https://www.expedia.com', 'manual', 'Manual research', 'Expedia TAAP (travel agents) and Rapid API by application');
    P('Priceline', 'online_package', 'https://www.priceline.com', 'manual', 'Manual research', 'Partner program by application');
    P('Booking.com', 'online_package', 'https://www.booking.com', 'manual', 'Manual research', 'Affiliate / Demand API by application');
    P('Hotels.com', 'hotel', 'https://www.hotels.com', 'manual', 'Manual research', 'Via Expedia Group partner programs');
    P('Apple Vacations', 'online_package', 'https://www.applevacations.com', 'manual', 'Manual research', 'Travel advisor booking engine: check eligibility');
    P('Funjet Vacations', 'online_package', 'https://www.funjet.com', 'manual', 'Manual research', 'Travel advisor booking engine: check eligibility');
    P('ALG Vacations (agent portal)', 'online_package', 'https://www.algvacations.com', 'manual', 'Manual research', 'Travel advisor portal');
    P('Costco Travel', 'online_package', 'https://www.costcotravel.com', 'manual', 'Manual research', 'Members only; no public API');
    // Airlines
    P('American Airlines', 'airline', 'https://www.aa.com', 'manual', 'Manual research', 'Flight data via GDS / NDC aggregators such as Duffel or Amadeus');
    P('Delta Air Lines', 'airline', 'https://www.delta.com', 'manual', 'Manual research', 'Flight data via GDS / NDC aggregators');
    P('United Airlines', 'airline', 'https://www.united.com', 'manual', 'Manual research', 'Flight data via GDS / NDC aggregators');
    P('Southwest Airlines', 'airline', 'https://www.southwest.com', 'manual', 'Manual research', 'Limited third party distribution');
    // Flight / hotel data APIs (Phase 2)
    P('Duffel (flight API)', 'airline', 'https://duffel.com', 'duffel', 'Not connected', 'Yes, API key required', 'Set DUFFEL_API_KEY to enable. Flight search across many airlines.');
    P('Amadeus Self-Service (flights and hotels)', 'airline', 'https://developers.amadeus.com', 'amadeus', 'Not connected', 'Yes, API key required', 'Set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET to enable.');
    // Activities
    P('Viator', 'activities', 'https://www.viator.com', 'viator', 'Not connected', 'Partner API by application', 'Set VIATOR_API_KEY to enable.');
    P('GetYourGuide', 'activities', 'https://www.getyourguide.com', 'manual', 'Manual research', 'Partner API by application');
  }

  if (one('SELECT COUNT(*) c FROM packages WHERE is_public=1').c === 0) {
    const { bySlug } = require('./content/destinations');
    const S = (slug, name, category, provider, hotel, room, nights, flight, inc, exc, acts, pp, imgs) => {
      const d = bySlug[slug];
      run(`INSERT INTO packages (destination_slug, destination_name, name, category, provider, summary, description, hotel_name, room_type,
        flight_details, transportation, activities, inclusions, exclusions, nights, travelers, estimated_price_pp, estimated_total, price_type,
        pricing_source, booking_source, images, is_sample, is_public, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,'Active')`,
        slug, d.name, name, category, provider,
        `${nights} nights at ${hotel}. ${d.summary.split('.')[0]}.`,
        `A sample ${category === 'luxury' ? 'premium' : category === 'budget' ? 'value' : 'balanced'} itinerary for ${d.name} to show how packages are presented. Your travel agent builds real packages around your dates, departure city and budget, and confirms current pricing with the supplier before anything is booked.`,
        hotel, room, flight, 'Private or shared airport transfers as listed', acts, inc, exc, nights, 2, pp, pp * 2, 'Sample',
        'Sample data for illustration only', 'Sample', JSON.stringify(imgs || [d.image]));
    };
    S('jamaica', 'Negril Beachfront All-Inclusive', 'budget', 'Sample package', 'Beachfront all-inclusive resort, Negril', 'Garden view room', 5,
      'Round trip economy, one stop from your home airport', 'All meals and drinks\nNonmotorized water sports\nShared airport transfers',
      'Excursions\nTravel insurance\nGratuities where not included', 'Sunset at Rick\'s Cafe\nSeven Mile Beach', 1450);
    S('jamaica', 'Montego Bay Adults-Only Escape', 'best', 'Sample package', 'Adults-only all-inclusive resort, Montego Bay', 'Ocean view junior suite', 5,
      'Round trip nonstop economy where available', 'All meals and premium drinks\nRound trip private transfers\nDaily activities and entertainment',
      'Travel insurance\nSpa services', 'Dunn\'s River Falls excursion\nCatamaran snorkel cruise', 2150);
    S('cancun', 'Riviera Maya Family Getaway', 'best', 'Sample package', 'Family all-inclusive resort, Riviera Maya', 'Family suite', 6,
      'Round trip nonstop economy where available', 'All meals and drinks\nKids club\nShared transfers', 'Park tickets\nTravel insurance',
      'Xcaret park day\nCenote swim', 1890);
    S('turks-and-caicos', 'Grace Bay Luxury Retreat', 'luxury', 'Sample package', 'Five star beachfront resort, Grace Bay', 'Oceanfront one bedroom suite', 6,
      'Round trip first class where available', 'Daily breakfast\nPrivate airport transfers\nResort credit', 'Lunch and dinner\nTravel insurance',
      'Private snorkel charter\nSunset sail', 4600);
    S('italy', 'Rome, Florence and Amalfi', 'best', 'Sample package', 'Four star boutique hotels in each city', 'Superior double rooms', 9,
      'Round trip economy, one stop', 'Daily breakfast\nHigh speed train between cities\nVatican early entry tour', 'Most dinners\nCity taxes',
      'Colosseum guided tour\nTuscan cooking class\nCapri boat day', 3900);
    S('bahamas', 'Nassau Long Weekend', 'budget', 'Sample package', 'Beach resort, Cable Beach', 'Partial ocean view room', 3,
      'Round trip economy', 'Resort access\nShared transfers', 'Meals\nResort fee\nExcursions', 'Exumas swimming pigs tour (optional add on)', 980);
  }
}
seed();

module.exports = { db, one, all, run, json, token, refCode, now, tx, notify, setRequestStatus };
