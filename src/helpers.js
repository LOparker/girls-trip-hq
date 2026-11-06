// View helpers available in every template.
const config = require('./config');
const { CUSTOMER_STATUS, PACKAGE_CATEGORIES } = require('./constants');

const money = (n, opts = {}) => {
  if (n == null || n === '' || isNaN(Number(n))) return opts.empty || 'Price on request';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: opts.currency || 'USD', maximumFractionDigits: opts.cents ? 2 : 0 });
};
const fmtDate = (d, opts) => {
  if (!d) return '';
  const dt = new Date(d.length === 10 ? d + 'T12:00:00' : d.replace(' ', 'T') + (d.includes('Z') || d.includes('+') || d.length === 10 ? '' : 'Z'));
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', opts || { month: 'short', day: 'numeric', year: 'numeric' });
};
const fmtDateTime = d => {
  if (!d) return '';
  const dt = new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z');
  if (isNaN(dt)) return d;
  return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' });
};
const nightsBetween = (a, b) => {
  if (!a || !b) return null;
  const n = Math.round((new Date(b) - new Date(a)) / 86400000);
  return n > 0 ? n : null;
};
const lines = t => (t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const statusClass = s => 'st-' + String(s || '').toLowerCase().replace(/[^a-z]+/g, '-');
const travelersText = (a, c) => {
  const parts = [];
  if (a) parts.push(`${a} adult${a == 1 ? '' : 's'}`);
  if (c) parts.push(`${c} child${c == 1 ? '' : 'ren'}`);
  return parts.join(', ') || 'Not specified';
};

module.exports = function locals(req, res, next) {
  Object.assign(res.locals, {
    brand: config.brand, money, fmtDate, fmtDateTime, nightsBetween, lines, statusClass, travelersText,
    CUSTOMER_STATUS, PACKAGE_CATEGORIES, path: req.path, year: new Date().getFullYear(), aiEnabled: config.ai.enabled
  });
  next();
};
module.exports.money = money;
module.exports.fmtDate = fmtDate;
module.exports.lines = lines;
module.exports.travelersText = travelersText;
module.exports.nightsBetween = nightsBetween;
