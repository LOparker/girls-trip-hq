// Turns a stored travel request (form fields + free text) into the requirement
// set the research agent scores options against.
const { json } = require('../db');
const { nightsBetween } = require('../helpers');

function parseMoney(s) {
  const m = s.match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  return Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1);
}

function ruleBasedFromText(text) {
  const t = (text || '').toLowerCase();
  const out = {};
  if (!t) return out;
  if (/all[\s-]?inclusive/.test(t)) out.all_inclusive = true;
  if (/adults?[\s-]?only|no kids/.test(t)) out.adults_only = true;
  if (/non[\s-]?stop|direct flight/.test(t)) out.nonstop_preferred = true;
  if (/beach[\s-]?front|on the beach/.test(t)) out.beachfront = true;
  if (/luxur|five[\s-]star|5[\s-]star/.test(t)) out.luxury = true;
  if (/kids|children|family/.test(t) && !out.adults_only) out.family_friendly = true;
  for (const o of ['birthday', 'honeymoon', 'anniversary', 'wedding', 'graduation', 'bachelorette', 'retirement']) if (t.includes(o)) out.occasion = o;
  const pp = text.match(/\$\s?[\d,]+(?:\.\d+)?\s*k?\s*(per person|a person|each|pp)/i);
  if (pp) out.budget_per_person = parseMoney(pp[0]);
  const tot = text.match(/\$\s?[\d,]+(?:\.\d+)?\s*k?\s*(total|budget|all in)/i) || text.match(/budget (is|of) \$\s?[\d,]+k?/i);
  if (tot && !pp) out.budget_total = parseMoney(tot[0]);
  return out;
}

function build(r, llmExtract, instructions) {
  const hotelPrefs = json(r.hotel_prefs, []);
  const experiences = json(r.experiences, []);
  const fromText = ruleBasedFromText([r.special_requests, instructions].filter(Boolean).join('\n'));
  const ai = llmExtract || {};
  const inferred = [];
  const pick = (formVal, key, label) => {
    if (formVal != null && formVal !== '' && formVal !== false) return formVal;
    if (fromText[key] != null && fromText[key] !== false) { inferred.push(`${label} (from the customer's notes)`); return fromText[key]; }
    if (ai[key] != null && ai[key] !== false && ai[key] !== '') { inferred.push(`${label} (read by AI from the customer's notes)`); return ai[key]; }
    return null;
  };
  const has = p => hotelPrefs.includes(p);
  const adults = r.adults || ai.adults || 2;
  const children = r.children ?? ai.children ?? 0;
  const pax = adults + children;
  const nights = nightsBetween(r.depart_date, r.return_date) || 5;
  const bpp = pick(r.budget_per_person, 'budget_per_person', 'Budget per person');
  const btot = pick(r.budget_total, 'budget_total', 'Total budget');
  const budgetTotal = btot || (bpp ? bpp * pax : null);

  const req = {
    destination: r.destination_flexible && !r.destination ? null : (r.destination || ai.destination || null),
    open_to_suggestions: Boolean(r.destination_flexible || ai.open_to_suggestions),
    departure_airport: r.departure_airport || null,
    depart_date: r.depart_date || ai.depart_date || null,
    return_date: r.return_date || ai.return_date || null,
    travel_month: ai.travel_month || null,
    flexible_dates: Boolean(r.flexible_dates),
    nights, adults, children, pax, rooms: r.rooms || 1,
    budget_total: budgetTotal,
    budget_per_person: bpp || (budgetTotal ? Math.round(budgetTotal / pax) : null),
    budget_flexible: Boolean(r.budget_flexible),
    style: r.vacation_style || null,
    wants: {
      all_inclusive: Boolean(has('All-inclusive') || r.vacation_style === 'All-Inclusive' || pick(null, 'all_inclusive', 'All-inclusive')),
      adults_only: Boolean(has('Adults-only') || pick(null, 'adults_only', 'Adults-only')),
      family_friendly: Boolean(has('Family-friendly') || r.vacation_style === 'Family Vacation' || children > 0 || pick(null, 'family_friendly', 'Family-friendly')),
      beachfront: Boolean(has('Beachfront') || r.vacation_style === 'Beach Vacation' || pick(null, 'beachfront', 'Beachfront')),
      luxury: Boolean(has('Luxury') || r.vacation_style === 'Luxury Getaway' || pick(null, 'luxury', 'Luxury')),
      budget_friendly: Boolean(has('Budget-friendly') || pick(null, 'budget_friendly', 'Budget-friendly')),
      boutique: has('Boutique hotel')
    },
    flight: {
      nonstop: Boolean(r.flight_pref === 'Nonstop preferred' || pick(null, 'nonstop_preferred', 'Nonstop flights')),
      one_stop_ok: r.flight_pref !== 'Nonstop preferred',
      cheapest: r.flight_pref === 'Cheapest available option',
      airline: r.preferred_airline || null,
      time: r.departure_time_pref || null,
      baggage: r.baggage || null
    },
    experiences: [...new Set([...experiences, ...(ai.activities_wanted || [])])],
    occasion: fromText.occasion || ai.occasion || null,
    notes: r.special_requests || null,
    agent_instructions: instructions || null,
    inferred,
    conflicts: []
  };
  if (req.wants.adults_only && children > 0) {
    req.conflicts.push('Adults-only was requested but children are traveling. Adults-only resorts were not required.');
    req.wants.adults_only = false;
  }
  if (!req.destination && !req.open_to_suggestions) req.conflicts.push('No destination given.');
  if (!req.budget_total) req.conflicts.push('No budget given, so options were not filtered by budget.');
  if (!r.depart_date) req.conflicts.push('No travel dates given; a 5 night stay was assumed for estimates.');
  return req;
}

module.exports = { build, ruleBasedFromText };
