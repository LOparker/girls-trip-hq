// Workflow statuses for a customer's trip request (spec section 10).
const REQUEST_STATUSES = [
  'New Inquiry',
  'Research Pending',
  'Research Completed',
  'Awaiting Agent Review',
  'Quote Sent',
  'Awaiting Customer Selection',
  'Customer Selected Package',
  'Booking in Progress',
  'Confirmed',
  'Completed',
  'Cancelled'
];

// What the customer is allowed to see for each internal status.
// Nothing reads as "booked" until the agent has recorded a confirmation.
const CUSTOMER_STATUS = {
  'New Inquiry': { label: 'Request received', detail: 'Your travel agent has your request and will begin researching options shortly.', step: 1 },
  'Research Pending': { label: 'Researching options', detail: 'Your travel agent is comparing flights, resorts and packages for your trip.', step: 1 },
  'Research Completed': { label: 'Researching options', detail: 'Your travel agent is reviewing the options found for your trip.', step: 1 },
  'Awaiting Agent Review': { label: 'Preparing your proposal', detail: 'Your travel agent is hand picking the best options for you.', step: 2 },
  'Quote Sent': { label: 'Proposal ready', detail: 'Your personalized proposal is ready to review.', step: 3 },
  'Awaiting Customer Selection': { label: 'Proposal ready', detail: 'Your personalized proposal is ready to review.', step: 3 },
  'Customer Selected Package': { label: 'Package selected, not yet booked', detail: 'Thank you for your selection. Your travel agent is confirming current availability and pricing. Your trip is not booked until you receive a confirmation.', step: 4 },
  'Booking in Progress': { label: 'Reservation in progress, not yet confirmed', detail: 'Your travel agent is working on your reservation with the travel supplier. You will receive a confirmation once it is complete.', step: 4 },
  'Confirmed': { label: 'Confirmed', detail: 'Your reservation has been confirmed by your travel agent.', step: 5 },
  'Completed': { label: 'Trip completed', detail: 'We hope you had a wonderful trip.', step: 5 },
  'Cancelled': { label: 'Cancelled', detail: 'This request has been cancelled. Contact us if you have questions.', step: 0 }
};

const CUSTOMER_STEPS = ['Request received', 'Research', 'Proposal', 'Selection and booking', 'Confirmed'];

const VACATION_STYLES = [
  'All-Inclusive', 'Beach Vacation', 'Luxury Getaway', 'Romantic Getaway', 'Family Vacation',
  'Adventure and Exploration', 'Cruise', 'Group Travel', 'Weekend Getaway', 'International Travel'
];

const FLIGHT_PREFS = ['Nonstop preferred', 'One stop is acceptable', 'Cheapest available option', 'No preference'];

const HOTEL_PREFS = ['All-inclusive', 'Adults-only', 'Family-friendly', 'Beachfront', 'Luxury', 'Budget-friendly', 'Boutique hotel', 'No preference'];

const EXPERIENCES = ['Relaxation', 'Nightlife', 'Excursions', 'Adventure', 'Shopping', 'Cultural experiences', 'Romantic experiences', 'Family activities'];

const DEPARTURE_TIMES = ['No preference', 'Morning', 'Afternoon', 'Evening', 'Red-eye is fine'];

const BAGGAGE = ['Carry-on only', '1 checked bag per person', '2 checked bags per person', 'Not sure yet'];

const PAYMENT_STATUSES = ['Not requested', 'Deposit requested', 'Deposit paid', 'Balance due', 'Paid in full', 'Refund pending', 'Refunded'];

const BOOKING_STATUSES = ['In Progress', 'Confirmed', 'Completed', 'Cancelled'];

const PACKAGE_CATEGORIES = {
  budget: 'Budget-Friendly Escape',
  best: 'Best Overall Experience',
  luxury: 'Luxury Vacation',
  standard: 'Vacation Package'
};

const PROVIDER_TYPES = {
  airline_vacations: 'Airline vacation packages',
  online_package: 'Online travel / package provider',
  airline: 'Airline',
  hotel: 'Hotel and resort',
  activities: 'Activities and excursions',
  transport: 'Transportation',
  demo: 'Demo data (not live)'
};

const EMAIL_TEMPLATES = {
  inquiry_confirmation: 'Inquiry confirmation',
  proposal: 'Vacation proposal',
  selection_ack: 'Package selection received',
  status_update: 'Booking status update',
  booking_confirmation: 'Booking confirmation',
  payment_reminder: 'Payment reminder',
  pre_departure: 'Pre-departure reminder',
  documents_reminder: 'Travel document reminder',
  post_trip: 'Post-vacation follow up'
};

module.exports = {
  REQUEST_STATUSES, CUSTOMER_STATUS, CUSTOMER_STEPS, VACATION_STYLES, FLIGHT_PREFS, HOTEL_PREFS,
  EXPERIENCES, DEPARTURE_TIMES, BAGGAGE, PAYMENT_STATUSES, BOOKING_STATUSES, PACKAGE_CATEGORIES,
  PROVIDER_TYPES, EMAIL_TEMPLATES
};
