// Central business settings. Change these to match your agency.
// Everything customer-facing (header, footer, emails) reads from here.
const path = require('path');

module.exports = {
  brand: {
    name: process.env.BRAND_NAME || 'Harbor & Horizon Travel',
    shortName: process.env.BRAND_SHORT || 'Harbor & Horizon',
    tagline: 'Personally planned vacations',
    email: process.env.BRAND_EMAIL || 'hello@example.com',
    phone: process.env.BRAND_PHONE || '(555) 010-0000',
    city: process.env.BRAND_CITY || 'Dallas, Texas',
    hours: 'Monday to Friday, 9am to 6pm Central',
    // Seller of travel registration numbers go here once issued (e.g. CST, WST, FST).
    sellerOfTravel: process.env.SELLER_OF_TRAVEL || ''
  },
  port: Number(process.env.PORT) || 3000,
  baseUrl: process.env.BASE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`,
  sessionSecret: process.env.SESSION_SECRET || 'change-this-secret-before-going-live',
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  uploadDir: path.join(__dirname, '..', 'uploads'),
  privateDocDir: path.join(process.env.DATA_DIR || path.join(__dirname, '..', 'data'), 'documents'),
  ai: {
    // When ANTHROPIC_API_KEY is set, the research agent uses Claude to read
    // free text requests and to write the plain language summary.
    model: process.env.AI_MODEL || 'claude-opus-5-5',
    enabled: Boolean(process.env.ANTHROPIC_API_KEY)
  }
};
