// AI Travel Research Assistant.
//
// What it does: reads a request, searches every active provider adapter,
// compares bundled packages against booking flight + hotel separately, calculates
// complete estimated costs, scores each option against the customer's stated
// requirements, picks three recommendations and writes an internal report.
//
// What it NEVER does: buy tickets, reserve rooms, book excursions, charge anyone,
// or confirm a booking. There is no code path for any of that. The human agent
// reviews the report and books everything personally.

const { one, all, run, json, now, setRequestStatus } = require('../db');
const providers = require('./providers');
const requirements = require('./requirements');
const llm = require('./llm');
const { destinations } = require('../content/destinations');

const EARLY = ['New Inquiry', 'Research Pending', 'Research Completed', 'Awaiting Agent Review'];
const round = n => Math.round(Number(n) || 0);

function log(runId, msg, progress) {
  const r = one('SELECT log FROM research_runs WHERE id=?', runId);
  const entries = json(r && r.log, []);
  entries.push({ at: now(), msg });
  if (progress != null) run('UPDATE research_runs SET log=?, progress=? WHERE id=?', JSON.stringify(entries), progress, runId);
  else run('UPDATE research_runs SET log=? WHERE id=?', JSON.stringify(entries), runId);
}

async function startRun(requestId, userId, instructions) {
  const r = one('SELECT * FROM travel_requests WHERE id=?', requestId);
  if (!r) throw new Error('Request not found');
  const ins = run("INSERT INTO research_runs (request_id, status, started_by, instructions, started_at, log) VALUES (?, 'running', ?, ?, ?, '[]')",
    requestId, userId || null, instructions || null, now());
  const runId = Number(ins.lastInsertRowid);
  if (EARLY.includes(r.status)) setRequestStatus(requestId, 'Research Pending', userId, 'AI research started');
  setImmediate(() => execute(runId).catch(err => {
    console.error('Research run failed', err);
    log(runId, 'Research failed: ' + err.message);
    run("UPDATE research_runs SET status='failed', completed_at=? WHERE id=?", now(), runId);
  }));
  return runId;
}

function bagsPerPerson(req) {
  const b = req.flight.baggage || '';
  if (b.startsWith('Carry')) return 0;
  if (b.startsWith('2')) return 2;
  return 1;
}

function quality(h) {
  if (!h) return 8;
  const stars = Number(h.stars) || 3;
  const rating = Number(h.guest_rating) || stars * 1.8;
  return (stars / 5) * 12 + (rating / 10) * 8;
}

function scoreOption(o, req) {
  const s = {};
  // Budget fit (30)
  if (!req.budget_total) s.budget = 20;
  else if (o.total <= req.budget_total) s.budget = 30;
  else {
    const over = (o.total - req.budget_total) / req.budget_total;
    s.budget = Math.max(0, 30 - over * (req.budget_flexible ? 60 : 120));
  }
  // Hotel preference match (30)
  const h = o.hotel || {};
  const checks = [];
  if (req.wants.all_inclusive) checks.push(Boolean(h.all_inclusive));
  if (req.wants.adults_only) checks.push(Boolean(h.adults_only));
  if (req.wants.family_friendly) checks.push(Boolean(h.family_friendly));
  if (req.wants.beachfront) checks.push(Boolean(h.beachfront));
  if (req.wants.luxury) checks.push(Number(h.stars) >= 4.5);
  if (req.wants.budget_friendly) checks.push(req.budget_total ? o.total <= req.budget_total * 0.85 : Number(h.stars) <= 3.5);
  s.preferences = checks.length ? (checks.filter(Boolean).length / checks.length) * 30 : 22;
  // Flight convenience (20)
  const stops = o.flight ? Number(o.flight.stops) : 1;
  if (req.flight.cheapest) s.flight = [16, 14, 10][Math.min(stops, 2)];
  else s.flight = [20, 13, 5][Math.min(stops, 2)] - (req.flight.nonstop && stops > 0 ? 4 : 0);
  if (req.flight.airline && o.flight && !String(o.flight.airline || '').toLowerCase().includes(req.flight.airline.toLowerCase())) s.flight -= 2;
  // Accommodation quality (20)
  s.quality = quality(h);
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  return { total: Math.round(total * 10) / 10, parts: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Math.round(v * 10) / 10])) };
}

function mustHaves(o, req) {
  const h = o.hotel || {};
  if (req.wants.all_inclusive && !h.all_inclusive) return false;
  if (req.wants.adults_only && !h.adults_only) return false;
  return true;
}

// Builds comparable options with full cost breakdowns.
function buildOptions(results, req) {
  const bags = bagsPerPerson(req);
  const opts = [];
  const flights = results.filter(x => x.result_type === 'flight');
  const hotels = results.filter(x => x.result_type === 'hotel');
  const pkgs = results.filter(x => x.result_type === 'package');
  const src = x => ({ provider: x.provider_name, url: x.source_url || null, retrieved_at: x.retrieved_at, availability: x.availability_status, is_sample: x.is_sample, result_id: x.id });

  for (const p of pkgs) {
    const d = p.data || {};
    const f = d.flight || {};
    const h = d.hotel || {};
    const costs = [{ label: 'Package price (flight + hotel' + (d.transfers_included ? ' + transfers' : '') + ')', amount: round(p.price_total) }];
    if (bags && f.baggage_fee_pp) costs.push({ label: `Checked bags (${bags} per person, round trip)`, amount: round(f.baggage_fee_pp * bags * req.pax) });
    if (!d.transfers_included && h.transfer_estimate) costs.push({ label: 'Airport transfers (estimate)', amount: round(h.transfer_estimate) });
    opts.push({ kind: 'Bundled package', provider: d.provider || p.provider_name, title: p.title, flight: f, hotel: h, costs,
      inclusions: d.inclusions || [], exclusions: d.exclusions || [], sources: [src(p)], is_sample: p.is_sample });
  }
  for (const f of flights) {
    for (const h of hotels) {
      const fd = f.data || {}, hd = h.data || {};
      const costs = [
        { label: `Airfare (${req.pax} traveler${req.pax > 1 ? 's' : ''})`, amount: round(f.price_total) },
        { label: 'Hotel room total', amount: round(hd.room_total ?? h.price_total) }
      ];
      if (hd.taxes) costs.push({ label: 'Hotel taxes', amount: round(hd.taxes) });
      if (hd.resort_fees) costs.push({ label: 'Resort fees', amount: round(hd.resort_fees) });
      if (bags && fd.baggage_fee_pp) costs.push({ label: `Checked bags (${bags} per person, round trip)`, amount: round(fd.baggage_fee_pp * bags * req.pax) });
      if (hd.transfer_estimate) costs.push({ label: 'Airport transfers (estimate)', amount: round(hd.transfer_estimate) });
      opts.push({ kind: 'Booked separately', provider: `${f.provider_name} + ${h.provider_name}`, title: `${fd.airline || f.title} + ${hd.name || h.title}`,
        flight: fd, hotel: hd, costs,
        inclusions: ['Round trip airfare', `${hd.nights || req.nights} nights accommodation`, ...(hd.all_inclusive ? ['All meals and drinks'] : [])],
        exclusions: ['Travel insurance', ...(hd.all_inclusive ? [] : ['Meals']), ...(hd.transfer_estimate ? [] : ['Airport transfers'])],
        sources: [src(f), src(h)], is_sample: f.is_sample || h.is_sample });
    }
  }
  for (const o of opts) {
    o.total = o.costs.reduce((a, c) => a + c.amount, 0);
    o.per_person = round(o.total / req.pax);
    o.within_budget = req.budget_total ? o.total <= req.budget_total : null;
    o.budget_diff = req.budget_total ? o.total - req.budget_total : null;
    o.meets_must_haves = mustHaves(o, req);
    o.score = scoreOption(o, req);
    o.quality = Math.round(quality(o.hotel) * 10) / 10;
  }
  return opts;
}

function reasonsFor(o, req) {
  const r = [];
  const h = o.hotel || {}, f = o.flight || {};
  if (f.stops === 0) r.push('a nonstop flight'); else if (f.stops === 1) r.push('a one stop flight');
  if (h.all_inclusive) r.push('an all-inclusive resort');
  if (h.adults_only) r.push('an adults-only setting');
  if (h.beachfront) r.push('a beachfront location');
  if (h.stars) r.push(`${h.stars} star accommodations${h.guest_rating ? ` rated ${h.guest_rating}/10 by guests` : ''}`);
  if ((o.inclusions || []).some(i => /transfer/i.test(i))) r.push('airport transfers included');
  if (o.within_budget === true) r.push(`an estimated total of $${o.total.toLocaleString()} that stays within the $${req.budget_total.toLocaleString()} budget`);
  else if (o.within_budget === false) r.push(`an estimated total of $${o.total.toLocaleString()}, which is $${o.budget_diff.toLocaleString()} over budget`);
  else r.push(`an estimated total of $${o.total.toLocaleString()}`);
  return r;
}
const joinList = a => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

function pickRecommendations(opts, req) {
  const eligible = opts.filter(o => o.meets_must_haves);
  const pool = eligible.length ? eligible : opts;
  const notes = [];
  if (!eligible.length && opts.length) notes.push('No option met every must-have (all-inclusive / adults-only). Recommendations relax those requirements.');
  const byScore = [...pool].sort((a, b) => b.score.total - a.score.total || a.total - b.total);
  const inBudget = pool.filter(o => o.within_budget !== false);
  const best = (inBudget.length ? [...inBudget].sort((a, b) => b.score.total - a.score.total || a.total - b.total)[0] : byScore[0]);
  const used = new Set([best]);
  const hotelUsed = new Set([best && best.hotel && best.hotel.name]);
  const cheapest = [...pool].sort((a, b) => a.total - b.total);
  const budget = cheapest.find(o => !used.has(o) && !hotelUsed.has(o.hotel && o.hotel.name)) || cheapest.find(o => !used.has(o));
  if (budget) { used.add(budget); hotelUsed.add(budget.hotel && budget.hotel.name); }
  const byQuality = [...pool].sort((a, b) => b.quality - a.quality || b.score.total - a.score.total);
  const premium = byQuality.find(o => !used.has(o) && !hotelUsed.has(o.hotel && o.hotel.name)) || byQuality.find(o => !used.has(o));
  return { best, budget, premium, notes };
}

function analysis(opts, recs, req) {
  if (!opts.length) return null;
  const by = (fn, dir = 1) => [...opts].sort((a, b) => dir * (fn(a) - fn(b)))[0];
  const name = o => o ? `${o.title} (${o.kind.toLowerCase()}, $${o.total.toLocaleString()})` : 'n/a';
  const flightRank = o => (o.flight ? Number(o.flight.stops) * 100 : 150) + (parseFloat(o.flight && o.flight.duration) || 0);
  const over = opts.filter(o => o.within_budget === false);
  return {
    best_match: name(by(o => o.score.parts.preferences * 10 + o.score.total, -1)),
    best_value: name(recs.best),
    most_affordable: name(by(o => o.total)),
    best_accommodations: name(by(o => o.quality, -1)),
    most_convenient_flights: name(by(flightRank)),
    most_benefits: name(by(o => (o.inclusions || []).length, -1)),
    over_budget: req.budget_total
      ? (over.length ? `${over.length} of ${opts.length} options exceed the $${req.budget_total.toLocaleString()} budget. ` +
        ['best', 'budget', 'premium'].filter(k => recs[k] && recs[k].within_budget === false).map(k => `The ${k === 'best' ? 'best overall' : k} recommendation is over by $${recs[k].budget_diff.toLocaleString()}.`).join(' ')
        : 'All options are within budget.')
      : 'No budget was given.'
  };
}

function bundleVsSeparate(opts) {
  const byHotel = {};
  for (const o of opts) {
    const k = (o.hotel && o.hotel.name) || o.title;
    byHotel[k] = byHotel[k] || {};
    const slot = o.kind === 'Bundled package' ? 'bundle' : 'separate';
    if (!byHotel[k][slot] || o.total < byHotel[k][slot].total) byHotel[k][slot] = o;
  }
  return Object.entries(byHotel).filter(([, v]) => v.bundle && v.separate).map(([hotel, v]) => ({
    hotel,
    bundle: { title: v.bundle.title, total: v.bundle.total },
    separate: { title: v.separate.title, total: v.separate.total },
    cheaper: v.bundle.total <= v.separate.total ? 'Bundle' : 'Separate',
    difference: Math.abs(v.bundle.total - v.separate.total),
    note: v.bundle.total <= v.separate.total
      ? 'Bundling is cheaper here once taxes, fees, bags and transfers are counted.'
      : 'Booking separately is cheaper here, even after adding bags and transfers.'
  }));
}

function destinationIdeas(req) {
  const style = (req.style || '').toLowerCase();
  const tags = [];
  if (/beach|all-inclusive|romantic|weekend/.test(style) || req.wants.beachfront || req.wants.all_inclusive) tags.push('beach');
  if (/family/.test(style) || req.children) tags.push('family');
  if (/luxury/.test(style) || req.wants.luxury) tags.push('luxury');
  if (/adventure/.test(style)) tags.push('adventure');
  if (/international/.test(style)) tags.push('international');
  if (/romantic/.test(style) || req.occasion) tags.push('romantic');
  const scored = destinations.map(d => ({ d, s: d.tags.filter(t => tags.includes(t)).length })).filter(x => x.s).sort((a, b) => b.s - a.s);
  return (scored.length ? scored : destinations.map(d => ({ d }))).slice(0, 4).map(x => x.d.name);
}

async function execute(runId) {
  const runRow = one('SELECT * FROM research_runs WHERE id=?', runId);
  const r = one('SELECT * FROM travel_requests WHERE id=?', runRow.request_id);
  const customer = one('SELECT name, email FROM customers WHERE id=?', r.customer_id);
  log(runId, 'Reading the customer request', 5);

  let extract = null;
  const freeText = [r.special_requests, runRow.instructions].filter(Boolean).join('\n\nAgent instructions: ');
  if (llm.enabled() && freeText) {
    try { extract = await llm.extractRequirements(freeText); log(runId, 'AI read the free text notes'); }
    catch (e) { log(runId, 'AI could not read notes, using rule based reading: ' + e.message); }
  }
  const req = requirements.build(r, extract, runRow.instructions);
  if (req.open_to_suggestions && !req.destination) {
    req.destination_ideas = destinationIdeas(req);
    req.destination = req.destination_ideas[0];
    log(runId, `Open destination. Suggested: ${req.destination_ideas.join(', ')}. Researching ${req.destination} first.`);
  }
  run('UPDATE research_runs SET requirements=? WHERE id=?', JSON.stringify(req), runId);
  log(runId, 'Requirements identified', 15);

  const provs = all('SELECT * FROM providers WHERE active=1 ORDER BY id');
  const searched = [];
  const manualChecks = [];
  const raw = [];
  let i = 0;
  for (const p of provs) {
    i++;
    const adapter = providers.get(p.adapter_key);
    if (adapter.manual) { manualChecks.push({ provider: p.name, type: p.type, url: p.website }); continue; }
    if (!adapter.isConfigured()) { searched.push({ provider: p.name, status: 'Not connected', results: 0 }); continue; }
    log(runId, `Searching ${p.name}`, 15 + Math.round((i / provs.length) * 55));
    try {
      const { results } = await adapter.search(req, p);
      for (const x of results) {
        const ins = run(`INSERT INTO research_results (run_id, request_id, provider_id, provider_name, result_type, title, data, price_total, price_per_person,
          currency, source_url, retrieved_at, availability_status, is_sample, entered_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'agent')`,
          runId, r.id, p.id, p.name, x.result_type, x.title, JSON.stringify(x.data), x.price_total, x.price_per_person, x.currency || 'USD',
          x.source_url || null, x.retrieved_at || now(), x.availability_status || 'Unverified', x.is_sample ? 1 : 0);
        raw.push({ ...x, id: Number(ins.lastInsertRowid), provider_name: p.name });
      }
      searched.push({ provider: p.name, status: 'Searched', results: results.length });
    } catch (e) {
      searched.push({ provider: p.name, status: 'Error: ' + e.message, results: 0 });
    }
  }
  // Options the agent researched by hand are part of every analysis.
  const manual = all("SELECT * FROM research_results WHERE request_id=? AND entered_by='agent_user' AND review_status!='Rejected'", r.id)
    .map(x => ({ ...x, data: json(x.data, {}) }));
  if (manual.length) searched.push({ provider: 'Options you added manually', status: 'Included', results: manual.length });
  const all_results = [...raw, ...manual];
  run('UPDATE research_runs SET providers_searched=? WHERE id=?', JSON.stringify(searched), runId);
  log(runId, `Comparing ${all_results.length} results: bundles versus flight + hotel booked separately`, 75);

  const opts = buildOptions(all_results, req);
  for (const o of opts) {
    const ins = run(`INSERT INTO research_results (run_id, request_id, provider_name, result_type, title, data, price_total, price_per_person, retrieved_at, availability_status, is_sample, entered_by)
      VALUES (?,?,?, 'option', ?,?,?,?,?,?,?, 'agent')`, runId, r.id, o.provider, o.title, JSON.stringify(o), o.total, o.per_person,
      o.sources.map(s => s.retrieved_at).sort()[0] || now(), o.sources.map(s => s.availability).join(' / '), o.is_sample ? 1 : 0);
    o.result_id = Number(ins.lastInsertRowid);
  }
  const recs = pickRecommendations(opts, req);
  const activities = all_results.filter(x => x.result_type === 'activity')
    .map(a => ({ title: a.title, price_pp: a.price_per_person, duration: a.data && a.data.duration, match: (a.data && a.data.tags || []).filter(t => req.experiences.includes(t)).length, is_sample: a.is_sample, url: a.source_url }))
    .sort((a, b) => b.match - a.match).slice(0, 4);

  const pack = (label, focus, o) => o && ({
    label, focus, result_id: o.result_id, title: o.title, kind: o.kind, provider: o.provider, flight: o.flight, hotel: o.hotel,
    costs: o.costs, total: o.total, per_person: o.per_person, within_budget: o.within_budget, budget_diff: o.budget_diff,
    inclusions: o.inclusions, exclusions: o.exclusions, sources: o.sources, is_sample: o.is_sample, score: o.score,
    why: `${focus} ${o.title} offers ${joinList(reasonsFor(o, req))}.`
  });
  const recommendations = [
    pack('Recommendation 1: Best Overall Value', 'Balances cost, quality, flight convenience and the customer\'s preferences.', recs.best),
    pack('Recommendation 2: Best Budget Option', 'Lowest complete cost that still meets the must-haves.', recs.budget),
    pack('Recommendation 3: Best Premium Option', 'Highest quality accommodations and experience.', recs.premium)
  ].filter(Boolean);

  const anyLive = all_results.some(x => !x.is_sample);
  const anySample = all_results.some(x => x.is_sample);
  const warnings = [...req.conflicts, ...recs.notes];
  if (anySample) warnings.unshift('Some or all results are SAMPLE data from the demo provider. They are not real prices or availability and must not be quoted to the customer.');
  if (!all_results.length) warnings.unshift('No results yet. Connect a provider or add researched options manually, then run research again.');
  warnings.push('All prices are estimates captured at the retrieval time shown. Verify price, availability and policies with the supplier before quoting or booking.');

  const top = recommendations[0];
  const report = {
    generated_at: now(),
    data_quality: anySample && !anyLive ? 'Sample data only' : anySample ? 'Mixed: live and sample' : all_results.length ? 'Retrieved / manually researched data' : 'No data',
    customer_request: {
      customer: customer.name, email: customer.email, destination: req.destination, destination_ideas: req.destination_ideas || null,
      departure_airport: req.departure_airport, dates: req.depart_date ? `${req.depart_date} to ${req.return_date || '?'}` : (req.travel_month || 'Not given'),
      flexible_dates: req.flexible_dates, nights: req.nights, travelers: `${req.adults} adults, ${req.children} children`, rooms: req.rooms,
      budget: req.budget_total ? `$${req.budget_total.toLocaleString()} total (about $${req.budget_per_person.toLocaleString()} per person)${req.budget_flexible ? ', flexible' : ''}` : 'Not given',
      preferences: Object.entries(req.wants).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' ')),
      flight: [req.flight.nonstop ? 'Nonstop preferred' : null, req.flight.cheapest ? 'Cheapest option' : null, req.flight.airline ? 'Prefers ' + req.flight.airline : null, req.flight.baggage].filter(Boolean),
      experiences: req.experiences, occasion: req.occasion, special_requests: req.notes, inferred: req.inferred
    },
    top_recommendation: top
      ? `I recommend Option 1, ${top.title}, because it offers the best combination of ${joinList(reasonsFor(recs.best, req))}, scoring ${top.score.total} out of 100 against the customer's requirements.`
      : 'There is not enough data to make a recommendation yet.',
    recommendations,
    analysis: analysis(opts, recs, req),
    bundle_vs_separate: bundleVsSeparate(opts),
    activities,
    providers_searched: searched,
    manual_checks: manualChecks,
    options_compared: opts.length,
    warnings,
    ai_summary: null
  };

  if (llm.enabled() && top) {
    log(runId, 'Writing the plain language summary', 90);
    try {
      report.ai_summary = await llm.writeSummary({
        customer_request: report.customer_request, recommendations: recommendations.map(x => ({ label: x.label, title: x.title, kind: x.kind, total: x.total, per_person: x.per_person, within_budget: x.within_budget, flight: x.flight, hotel: x.hotel, inclusions: x.inclusions, exclusions: x.exclusions, is_sample: Boolean(x.is_sample), score: x.score })),
        analysis: report.analysis, bundle_vs_separate: report.bundle_vs_separate, warnings
      });
    } catch (e) { log(runId, 'AI summary skipped: ' + e.message); }
  }

  run("UPDATE research_runs SET status='completed', progress=100, completed_at=?, report=? WHERE id=?", now(), JSON.stringify(report), runId);
  log(runId, 'Research complete. Report ready for review.', 100);
  const cur = one('SELECT status FROM travel_requests WHERE id=?', r.id).status;
  if (EARLY.includes(cur)) {
    setRequestStatus(r.id, 'Research Completed', null, `Research run #${runId} completed`);
    setRequestStatus(r.id, 'Awaiting Agent Review', null, 'Report ready for agent review');
  }
}

module.exports = { startRun, buildOptions, scoreOption };
