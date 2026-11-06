// Provider adapter registry. To connect a new supplier, write an adapter with
// { key, isConfigured(), search(requirements, providerRow) } and register it here,
// then set the provider's adapter_key in Dashboard > Providers. Nothing else in
// the website needs to change.
//
// Adapters must ONLY search and return results. They must never purchase,
// reserve, hold or confirm anything. Booking is always done by the human agent.
//
// Use authorized APIs, affiliate feeds or agent portals only. Do not scrape
// supplier websites unless their terms explicitly permit it.

const sample = require('./sample');

const notConnected = (key, envVars, docs) => ({
  key,
  envVars,
  isConfigured: () => envVars.every(v => Boolean(process.env[v])),
  async search() {
    // Phase 2: implement the authorized API call here and map the response to
    // { result_type: 'flight'|'hotel'|'package'|'activity', title, data, price_total,
    //   price_per_person, currency, source_url, availability_status, retrieved_at }
    throw new Error(`The ${key} adapter has credentials but the API mapping is not built yet. See ${docs}`);
  }
});

// Providers researched by hand (agent portals, airline vacation sites). The agent
// lists them as "check manually" with a link, and you add what you find with
// "Add researched option".
const manual = { key: 'manual', isConfigured: () => true, manual: true, async search() { return { results: [], note: 'Manual research provider' }; } };

const adapters = {
  sample,
  manual,
  duffel: notConnected('duffel', ['DUFFEL_API_KEY'], 'https://duffel.com/docs'),
  amadeus: notConnected('amadeus', ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'], 'https://developers.amadeus.com'),
  viator: notConnected('viator', ['VIATOR_API_KEY'], 'https://docs.viator.com/partner-api/')
};

module.exports = { adapters, get: k => adapters[k] || manual };
