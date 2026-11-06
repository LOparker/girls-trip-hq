# Travel Agency Platform (Phase 1)

A working travel agency website, private agent dashboard and AI travel research assistant.

The research assistant **researches, compares and recommends. It never books, reserves, charges or confirms anything.** Every booking is completed by you, the human agent, and only you can mark a trip Confirmed.

## Run it on your computer

Requires Node.js 22.13 or newer (you have v24).

```bash
npm install
npm start
```

Then open:

* Website: http://localhost:3000
* Dashboard: http://localhost:3000/admin (the first visit asks you to create the owner account)

Settings live in `.env` (copy `.env.example` to `.env`). The brand name, phone, email and city are placeholders until you change them there.

## How a trip flows through the system

1. **Customer** submits the trip planner or custom inquiry form. A customer record and trip request are saved, an inquiry confirmation email is drafted, and you get a notification.
2. **Research assistant** runs automatically on every new request (and again whenever you click Start AI research, with optional instructions). It
   * reads the form and the customer's own words (Claude reads free text when `ANTHROPIC_API_KEY` is set; otherwise rule based),
   * searches every active provider adapter,
   * compares bundled packages against booking flight + hotel separately, adding taxes, resort fees, checked bags and transfers,
   * scores each option against budget, hotel preferences, flight convenience and quality,
   * writes a private report: AI's Top Recommendation, Best Overall Value, Best Budget, Best Premium, decision analysis, bundle versus separate, providers searched and the providers you should check by hand.
3. **You review** the report, approve or reject options, add anything you priced yourself ("Add researched option"), and turn the options you like into packages.
4. **Proposal**: tick packages, set markup or service fee, add notes, preview, publish. Prices are frozen as quoted. The proposal email is drafted for your approval.
5. **Customer selects** a vacation. They are told clearly it is not booked yet. You are notified and the original quoted price and pricing check time are preserved.
6. **You book** with the supplier, record supplier, portal, final price, confirmation number and documents, then press Confirm reservation. Only then does the customer's status page say Confirmed.

Safeguards built in: proposals containing sample data cannot be sent; a request cannot be marked Confirmed without a recorded supplier confirmation; payments can only be logged on confirmed reservations; customer pages never show AI analysis, supplier notes, costs or margins; no card data is stored anywhere.

## Sample data

So you can try everything today, a **Sample Data (demo only)** provider generates clearly labeled fictional results, and the website ships with six labeled sample packages. Before launch:

* Dashboard > Travel providers: turn off "Sample Data (demo only)".
* Dashboard > Packages: deactivate the sample packages and add your real ones.

## Project layout

```
server.js                 starts the web server
src/config.js             brand and settings
src/db.js                 database tables (SQLite file in data/agency.db) and starter data
src/content/destinations.js   destination guide text and photos
src/routes/public.js      customer website
src/routes/admin.js       agent dashboard
src/research/agent.js     research assistant: compare, score, recommend, report
src/research/llm.js       optional Claude integration (reading requests, writing summaries)
src/research/providers/   one adapter per supplier; add new ones here
src/emails.js             customer email templates (always drafted for your approval)
views/                    page templates
public/                   styles and scripts
```

## Adding a real provider (Phase 2)

Each supplier is an adapter in `src/research/providers/` with `search(requirements)` that returns flights, hotels, packages or activities. Register it in `providers/index.js`, then pick it on the provider's row in Dashboard > Travel providers. Use authorized APIs, affiliate feeds or agent portals only (for example Duffel or Amadeus for flights, Expedia TAAP or Rapid, Viator Partner API). Do not scrape supplier sites, and record any partner relationship only once it actually exists.

## Before going live

* Set `SESSION_SECRET`, `BASE_URL` (https) and your real brand details.
* Register as a seller of travel where required, and set up your host agency or supplier agreements. Add registration numbers in `SELLER_OF_TRAVEL`.
* Have the Terms and Privacy pages reviewed by an attorney.
* Connect an email service (emails are drafted and approved in the dashboard today; you send them from your own inbox and mark them sent).
* Back up `data/` regularly. It holds customer data, logins and booking documents and is deliberately excluded from Git.
