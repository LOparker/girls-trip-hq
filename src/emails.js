// Customer email drafts. Nothing is sent automatically: every message is saved
// as a Draft in the Communications outbox for the agent to review and approve.
const config = require('./config');
const { run, one } = require('./db');
const { money, fmtDate } = require('./helpers');
const { EMAIL_TEMPLATES, CUSTOMER_STATUS } = require('./constants');

const sig = () => `Warm regards,\n${config.brand.name}\n${config.brand.phone}  |  ${config.brand.email}`;
const statusLink = r => `${config.baseUrl}/trip/${r.access_token}`;
const first = name => (name || '').split(' ')[0] || 'there';

function build(template, ctx) {
  const { request: r, customer: c, proposal, booking } = ctx;
  const dest = r.destination || 'your trip';
  switch (template) {
    case 'inquiry_confirmation':
      return {
        subject: `We received your ${dest} vacation request (${r.ref_code})`,
        body: `Hi ${first(c.name)},\n\nThank you for reaching out. Your travel agent has received your request for ${dest} and will start researching flights, resorts and packages that fit your plans.\n\nYour reference number is ${r.ref_code}. You can check the status of your request at any time here:\n${statusLink(r)}\n\nNothing has been booked yet. We will send you a personalized proposal to review first.\n\n${sig()}`
      };
    case 'proposal':
      return {
        subject: `Your ${dest} vacation proposal is ready`,
        body: `Hi ${first(c.name)},\n\nI have put together a few vacation options for ${dest} based on what you told me. You can review and compare them here:\n${config.baseUrl}/proposal/${proposal.token}\n\nPrices shown are quotes based on availability when I last checked and can change until a reservation is confirmed. When you find the one you love, choose Select This Vacation and I will confirm current availability and pricing with you before anything is booked.\n\n${sig()}`
      };
    case 'selection_ack':
      return {
        subject: `Thank you for choosing your ${dest} vacation`,
        body: `Hi ${first(c.name)},\n\nThank you for selecting your vacation package. I will review the details and contact you to confirm current availability, pricing and the next steps.\n\nPlease note your trip is not booked yet. You will receive a separate confirmation once the reservation is complete.\n\nTrack your request: ${statusLink(r)}\n\n${sig()}`
      };
    case 'status_update': {
      const s = CUSTOMER_STATUS[r.status] || { label: r.status, detail: '' };
      return {
        subject: `Update on your ${dest} trip: ${s.label}`,
        body: `Hi ${first(c.name)},\n\nA quick update on your trip request (${r.ref_code}).\n\nCurrent status: ${s.label}\n${s.detail}\n\nYou can view the latest details here:\n${statusLink(r)}\n\n${sig()}`
      };
    }
    case 'booking_confirmation':
      return {
        subject: `Confirmed: your ${dest} vacation`,
        body: `Hi ${first(c.name)},\n\nGreat news. Your reservation is confirmed.\n\nSupplier: ${booking?.supplier || ''}\nConfirmation number: ${booking?.confirmation_number || ''}\nTravel dates: ${fmtDate(booking?.travel_start)} to ${fmtDate(booking?.travel_end)}\nTotal: ${money(booking?.final_price)}\n\nYou can see your trip details here:\n${statusLink(r)}\n\nI will be in touch before departure with reminders and travel documents.\n\n${sig()}`
      };
    case 'payment_reminder':
      return {
        subject: `Payment reminder for your ${dest} trip`,
        body: `Hi ${first(c.name)},\n\nThis is a friendly reminder that a payment for your confirmed ${dest} trip is coming due. Please reply to this email or call ${config.brand.phone} if you have any questions about the amount or due date.\n\nFor your security we never ask for card numbers by email.\n\n${sig()}`
      };
    case 'pre_departure':
      return {
        subject: `Getting ready for ${dest}`,
        body: `Hi ${first(c.name)},\n\nYour trip is almost here. A few reminders:\n\nCheck in for your flight 24 hours before departure.\nMake sure passports are valid for at least six months beyond your return date.\nKeep your confirmation numbers handy on your phone.\n\nHave a wonderful trip, and reach out any time if you need help.\n\n${sig()}`
      };
    case 'documents_reminder':
      return {
        subject: `Travel documents for your ${dest} trip`,
        body: `Hi ${first(c.name)},\n\nPlease make sure everyone traveling has the documents they need, including valid passports and any required entry forms or authorizations for ${dest}. Requirements can change, so check official government sources before you go.\n\nLet me know if you would like help reviewing anything.\n\n${sig()}`
      };
    case 'post_trip':
      return {
        subject: `Welcome home from ${dest}`,
        body: `Hi ${first(c.name)},\n\nWelcome home. I hope ${dest} was everything you hoped for. I would love to hear how it went, and whenever you are ready to plan the next one, I am here to help.\n\n${sig()}`
      };
    default:
      return { subject: '', body: `Hi ${first(c.name)},\n\n\n\n${sig()}` };
  }
}

function draft(template, requestId, extra = {}, userId = null) {
  const request = one('SELECT * FROM travel_requests WHERE id=?', requestId);
  if (!request) return null;
  const customer = one('SELECT * FROM customers WHERE id=?', request.customer_id);
  const { subject, body } = build(template, { request, customer, ...extra });
  const r = run('INSERT INTO communications (request_id, customer_id, template, to_email, subject, body, status, created_by) VALUES (?,?,?,?,?,?,?,?)',
    requestId, customer.id, template, customer.email, subject, body, 'Draft', userId);
  return Number(r.lastInsertRowid);
}

module.exports = { draft, build, EMAIL_TEMPLATES };
