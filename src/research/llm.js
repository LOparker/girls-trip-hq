// Optional Claude integration for the research assistant.
// Used for two narrow jobs only: (1) reading a customer's free text request into
// structured requirements, and (2) writing the plain language summary of a report
// from facts the agent already retrieved. It never searches, books or charges.
const config = require('../config');

let client = null;
function getClient() {
  if (!config.ai.enabled) return null;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic.default ? new Anthropic.default() : new Anthropic();
  }
  return client;
}

// Server side fallback lets the API retry on another model if a request is declined.
async function create(params) {
  const c = getClient();
  try {
    return await c.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e && e.status === 400) return await c.messages.create(params); // account without the beta
    throw e;
  }
}
const textOf = msg => (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

const REQUIREMENTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    destination: { type: ['string', 'null'] },
    open_to_suggestions: { type: 'boolean' },
    depart_date: { type: ['string', 'null'], description: 'YYYY-MM-DD if stated' },
    return_date: { type: ['string', 'null'] },
    travel_month: { type: ['string', 'null'] },
    adults: { type: ['integer', 'null'] },
    children: { type: ['integer', 'null'] },
    budget_total: { type: ['number', 'null'] },
    budget_per_person: { type: ['number', 'null'] },
    all_inclusive: { type: 'boolean' },
    adults_only: { type: 'boolean' },
    family_friendly: { type: 'boolean' },
    beachfront: { type: 'boolean' },
    luxury: { type: 'boolean' },
    budget_friendly: { type: 'boolean' },
    nonstop_preferred: { type: 'boolean' },
    occasion: { type: ['string', 'null'], description: 'birthday, honeymoon, anniversary, etc.' },
    activities_wanted: { type: 'array', items: { type: 'string' } },
    other_notes: { type: ['string', 'null'] }
  },
  required: ['destination', 'open_to_suggestions', 'depart_date', 'return_date', 'travel_month', 'adults', 'children', 'budget_total',
    'budget_per_person', 'all_inclusive', 'adults_only', 'family_friendly', 'beachfront', 'luxury', 'budget_friendly',
    'nonstop_preferred', 'occasion', 'activities_wanted', 'other_notes']
};

async function extractRequirements(text) {
  if (!getClient() || !text || text.trim().length < 15) return null;
  const msg = await create({
    model: config.ai.model,
    max_tokens: 2000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: REQUIREMENTS_SCHEMA } },
    system: 'You extract vacation requirements from a travel agency customer\'s own words. Only record what the customer actually said or clearly implied. Use null or false when something is not mentioned. Do not guess dates or budgets.',
    messages: [{ role: 'user', content: `Customer request:\n"""${text.slice(0, 6000)}"""` }]
  });
  if (msg.stop_reason === 'refusal') return null;
  try { return JSON.parse(textOf(msg)); } catch { return null; }
}

async function writeSummary(facts) {
  if (!getClient()) return null;
  const msg = await create({
    model: config.ai.model,
    max_tokens: 3000,
    output_config: { effort: 'medium' },
    system: 'You are a research assistant for a human travel agent. Write for the agent, not the customer. Use only the facts in the JSON you are given: never invent prices, availability, hotel features or policies. If data is labeled as sample data, say so plainly. Write 2 short paragraphs in plain language: first, which option you recommend and why, tied to the customer\'s stated requirements; second, the tradeoffs of the other options and anything the agent should verify with the supplier before quoting (prices, availability, policies). No headings, no bullet points.',
    messages: [{ role: 'user', content: JSON.stringify(facts) }]
  });
  if (msg.stop_reason === 'refusal') return null;
  return textOf(msg) || null;
}

module.exports = { extractRequirements, writeSummary, enabled: () => Boolean(getClient()) };
