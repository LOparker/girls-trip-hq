// DEMO ONLY. Generates realistic looking but fictional results so the research
// workflow can be tested before real supplier integrations exist. Every result is
// flagged is_sample = 1 and labeled "SAMPLE" everywhere it appears. Never quote
// these prices to a customer.
const crypto = require('crypto');

function rng(seedStr) {
  let s = crypto.createHash('md5').update(seedStr).digest().readUInt32LE(0);
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const round = n => Math.round(n);

const REGION_COST = [
  [/japan|bali|dubai|asia/i, { fare: 1250, night: 1.25 }],
  [/paris|london|italy|greece|europe/i, { fare: 950, night: 1.2 }],
  [/hawaii/i, { fare: 720, night: 1.4 }],
  [/turks|caicos/i, { fare: 620, night: 1.6 }],
  [/.*/, { fare: 520, night: 1 }]
];

module.exports = {
  key: 'sample',
  isConfigured: () => true,
  async search(req, provider) {
    const dest = req.destination || 'Caribbean (open destination)';
    const r = rng(dest + req.pax + req.nights + (req.depart_date || ''));
    const cost = REGION_COST.find(([re]) => re.test(dest))[1];
    const nights = req.nights, pax = req.pax, rooms = req.rooms;
    const from = (req.departure_airport || 'DFW').toUpperCase().slice(0, 30);
    const retrieved = new Date().toISOString();
    const tag = 'SAMPLE';

    const flights = [
      { airline: 'Sample Air (nonstop)', stops: 0, fare_pp: round(cost.fare * (1.15 + r() * 0.2)), duration: '3h 40m', dep: '08:15', arr: '12:55', bag_pp: 70, seat_pp: 0 },
      { airline: 'Example Airways (1 stop)', stops: 1, fare_pp: round(cost.fare * (0.85 + r() * 0.15)), duration: '6h 25m', dep: '06:05', arr: '13:30', bag_pp: 80, seat_pp: 30, layover: '1h 50m connection' },
      { airline: 'Demo Jet (2 stops, basic economy)', stops: 2, fare_pp: round(cost.fare * (0.7 + r() * 0.1)), duration: '9h 10m', dep: '05:30', arr: '16:40', bag_pp: 90, seat_pp: 45, layover: 'Two connections' }
    ];
    const hotels = [
      { name: 'Sample Seaside Inn', stars: 3, rating: 7.9, all_inclusive: false, adults_only: false, family_friendly: true, beachfront: false, room: 'Standard room', night: 165, resort_fee: 25, amenities: ['Pool', 'Free wifi', 'Short walk to beach'] },
      { name: 'Sample Palms All-Inclusive', stars: 4, rating: 8.6, all_inclusive: true, adults_only: false, family_friendly: true, beachfront: true, room: 'Ocean view room', night: 410, resort_fee: 0, amenities: ['All meals and drinks', 'Kids club', 'Three pools', 'Nonmotorized water sports'] },
      { name: 'Sample Serenity Adults-Only Resort', stars: 4.5, rating: 9.1, all_inclusive: true, adults_only: true, family_friendly: false, beachfront: true, room: 'Junior suite, swim up', night: 560, resort_fee: 0, amenities: ['All meals and premium drinks', 'Spa', 'Adults only', 'Beachfront'] },
      { name: 'Sample Grand Reserve', stars: 5, rating: 9.4, all_inclusive: false, adults_only: false, family_friendly: true, beachfront: true, room: 'Oceanfront suite', night: 890, resort_fee: 60, amenities: ['Butler service', 'Fine dining', 'Private beach cabanas', 'Spa'] }
    ].map(h => ({ ...h, night: round(h.night * cost.night * (0.9 + r() * 0.2)) }));

    const out = [];
    const flightData = f => ({
      airline: f.airline, route: `${from} to ${dest} round trip`, stops: f.stops, duration: f.duration,
      outbound: `Departs ${f.dep}, arrives ${f.arr}`, layover: f.layover || null, fare_pp: f.fare_pp,
      baggage_fee_pp: f.bag_pp, seat_fee_pp: f.seat_pp, cabin: f.stops === 2 ? 'Basic economy' : 'Main cabin',
      cancellation: f.stops === 2 ? 'Nonrefundable' : 'Cancel for airline credit', change_policy: f.stops === 2 ? 'No changes' : 'Changes allowed, fare difference applies'
    });
    const hotelData = h => {
      const base = h.night * nights * rooms;
      const taxes = round(base * 0.13);
      return { name: h.name, stars: h.stars, guest_rating: h.rating, all_inclusive: h.all_inclusive, adults_only: h.adults_only,
        family_friendly: h.family_friendly, beachfront: h.beachfront, room_type: h.room, nightly_rate: h.night, nights, rooms,
        room_total: base, taxes, resort_fees: h.resort_fee * nights * rooms, amenities: h.amenities, location: dest,
        transfer_estimate: round(35 * pax), cancellation: 'Free cancellation until 14 days before arrival',
        total: base + taxes + h.resort_fee * nights * rooms };
    };

    for (const f of flights) {
      const d = flightData(f);
      out.push({ result_type: 'flight', title: `${f.airline}, ${from} round trip`, data: d,
        price_per_person: f.fare_pp, price_total: f.fare_pp * pax, source_url: '', availability_status: `${tag}: not live`, is_sample: 1, retrieved_at: retrieved });
    }
    for (const h of hotels) {
      const d = hotelData(h);
      out.push({ result_type: 'hotel', title: `${h.name} (${h.room})`, data: d, price_total: d.total, price_per_person: round(d.total / pax),
        source_url: '', availability_status: `${tag}: not live`, is_sample: 1, retrieved_at: retrieved });
    }
    // Bundled packages: bundles often discount the hotel and include transfers.
    const bundles = [
      { provider: 'Sample Airline Vacations', f: flights[0], h: hotels[1], disc: 0.9 },
      { provider: 'Sample Airline Vacations', f: flights[0], h: hotels[2], disc: 0.92 },
      { provider: 'Sample Online Travel Co.', f: flights[1], h: hotels[0], disc: 0.97 },
      { provider: 'Sample Online Travel Co.', f: flights[1], h: hotels[3], disc: 1.02 }
    ];
    for (const b of bundles) {
      const fd = flightData(b.f), hd = hotelData(b.h);
      const total = round((b.f.fare_pp * pax + hd.room_total) * b.disc + hd.taxes + hd.resort_fees);
      out.push({
        result_type: 'package', title: `${b.provider}: ${b.h.name} + ${b.f.airline}`,
        data: { provider: b.provider, flight: fd, hotel: hd, transfers_included: true, nights,
          inclusions: ['Round trip airfare', `${nights} nights accommodation`, 'Round trip airport transfers', ...(b.h.all_inclusive ? ['All meals and drinks'] : [])],
          exclusions: ['Checked bag fees', 'Travel insurance', ...(b.h.all_inclusive ? [] : ['Meals'])] },
        price_total: total, price_per_person: round(total / pax), source_url: '', availability_status: `${tag}: not live`, is_sample: 1, retrieved_at: retrieved
      });
    }
    const acts = [
      { name: 'Sample catamaran snorkel cruise', price: 95, dur: '4 hours', tags: ['Excursions', 'Relaxation', 'Romantic experiences'] },
      { name: 'Sample guided culture and food tour', price: 75, dur: '5 hours', tags: ['Cultural experiences', 'Shopping'] },
      { name: 'Sample zipline and waterfall adventure', price: 120, dur: '6 hours', tags: ['Adventure', 'Family activities', 'Excursions'] },
      { name: 'Sample sunset dinner cruise', price: 140, dur: '3 hours', tags: ['Romantic experiences', 'Nightlife'] }
    ];
    for (const a of acts) {
      out.push({ result_type: 'activity', title: a.name, data: { name: a.name, description: `Fictional ${a.dur} excursion used for testing.`, price_pp: a.price, duration: a.dur, location: dest, tags: a.tags },
        price_per_person: a.price, price_total: a.price * pax, source_url: '', availability_status: `${tag}: not live`, is_sample: 1, retrieved_at: retrieved });
    }
    return { results: out, note: 'Generated sample data (not live).' };
  }
};
