# NXGS Party App

Party and event booking for **Next Generation Sports Complex**: customers book and pay online, and staff manage everything from one admin page.

## What it does

**For customers** (`/book`, which can be embedded on nxgs.net)
- Pick a kids party package and number of kids (15 included, $25 each extra, max 20)
- See only the start times that are actually open. The scheduler enforces:
  - two parties at once, at most
  - one video game room, never double-booked (60 min play → 30 min game room → 30 min food)
  - 15 min cleanup between parties
- Add extras (pizza, deli, shirts, goodie bags)
- Pay a **25% non-refundable deposit** through Stripe. Parties booked within 7 days are paid in full.
- Get a confirmation/receipt page that also has a **Pay balance** button. The balance is due 7 days before the party.
- Corporate, adult, senior and team skill-building events use an inquiry form, and each inquiry becomes a lead.

**For staff** (`/admin`, password protected)
- Dashboard: upcoming parties, booked value, balances owed, overdue balances, money collected, new leads
- Party list with full detail: schedule, receipt, payments
- Record desk payments (card, cash, check) and cancel parties
- Lead tracker: new → contacted → quoted → booked/lost, with follow-up dates
- Reports: revenue by month, plus **vendor order totals** for upcoming parties (Calabria Pizza, Amia's Deli, Lifestyles Sports)
- CSV exports for bookings and payments. The payments CSV is laid out for QuickBooks Online import.

## Change prices, hours and packages

Everything lives in **`src/config.js`**: packages, prices, add-ons, vendor costs, party hours by day, deposit %, tax rate, and how many parties can run at once. Edit that file and restart the app. The current prices are a working model.

> ⚠️ Sales tax is set to 8.625% (Nassau County) on every item. Confirm the rate and which items are taxable with your accountant.

## Run it

You need **Node.js 22.13 or newer**. There are no other dependencies, so you don't need to run `npm install`.

```bash
npm run demo     # admin password "demo", payments simulated
npm test         # 11 automated tests
```

Then open http://localhost:3000/book and http://localhost:3000/admin.

## Settings (environment variables)

| Variable | What it's for |
|---|---|
| `ADMIN_PASSWORD` | Required to use `/admin`. Pick a strong one. |
| `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_test_…` to test, `sk_live_…` for real). Without it, the app runs in demo mode. |
| `STRIPE_WEBHOOK_SECRET` | From the Stripe webhook below (`whsec_…`). |
| `BASE_URL` | The public address, e.g. `https://book.nxgs.net` |
| `PORT` | Defaults to 3000 |
| `DB_FILE` | Where bookings are stored. Defaults to `data/nxgs.db`. **Back this file up.** |
| `EMBED_ORIGINS` | Sites allowed to embed the booking page, e.g. `https://www.nxgs.net`. Defaults to any site. |

## Connect Stripe

1. In Stripe, go to **Developers → API keys** and copy the secret key into `STRIPE_SECRET_KEY`.
2. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-APP-ADDRESS/webhooks/stripe`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. In **Settings → Customer emails**, turn on "Successful payments" so Stripe emails every customer a receipt.

## Put it on nxgs.net

Host the app on any Node host (Render, Railway, a small VPS) and point a subdomain at it, e.g. `book.nxgs.net`. Then add this embed to the website:

```html
<iframe src="https://book.nxgs.net/book" style="width:100%;min-height:1800px;border:0" title="Book a party"></iframe>
```

The embed works the same way on Base44 now and on WordPress later. You can also just link a "Book a Party" button straight to `https://book.nxgs.net/book`.

## Code layout

```
src/config.js      business settings (prices, hours, packages, vendors)
src/scheduling.js  open time slots and conflict rules
src/pricing.js     quotes, tax, deposit, balance due date
src/bookings.js    bookings, payments, leads, dashboard numbers
src/stripe.js      Stripe Checkout and webhook verification
src/server.js      web server and pages
public/            booking page, admin page, styles
test/              automated tests
```

## Not built yet

- Automatic reminder emails/texts (balance due, party reminder)
- Direct QuickBooks Online sync (CSV export for now)
- Online refunds (issue them in Stripe for now)
- Multi-facility setup, for selling the app to other facilities or running the Massapequa location
