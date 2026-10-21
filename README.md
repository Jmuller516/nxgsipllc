# NXGS Party App

Party and event booking for **Next Generation Sports Complex**: customers book and pay online, and staff manage everything from one admin page.

## What it does

**For customers**
- **Live availability calendar** (`/calendar`): a month view showing which days are Open, Few left, Booked or Closed. It updates automatically every 30 seconds. Customers tap a day to see open start times, and tapping a time opens the booking form with the date and time filled in. They never see who booked.

**Booking form** (`/book`)
- Pick a kids party package and number of kids (15 included, $25 each extra, max 20)
- See only the start times that are actually open. The scheduler enforces:
  - two parties at once, at most
  - one video game room, never double-booked (60 min play → 30 min game room → 30 min food)
  - 15 min cleanup between parties
- Add extras: food (Calabria Pizza, Amia's Deli), plus all 20 favors and decorations from the NXGS Birthday Add-Ons guide. Each item has its minimum order and lead time, and items that can't be made in time for the chosen date are greyed out.
- Pay a **25% non-refundable deposit** through Stripe. Parties booked within 7 days are paid in full.
- Get a confirmation/receipt page that also has a **Pay balance** button. The balance is due 7 days before the party.
- Corporate, adult, senior and team skill-building events use an inquiry form, and each inquiry becomes a lead.
- Automatic emails: booking confirmation, payment receipts, balance reminder (3 days before it's due), past-due notice, and "see you tomorrow"

**For staff** (`/admin`, password protected)
- **Calendar**: a month view of every party, with names, holds in yellow, and a red edge when a balance is overdue. Tap a day to see its parties or **close the day or a time block** for holidays, tournaments or rentals. Customers can't book closed times, and you're warned if a party is already booked in that window.
- **Google Calendar / iPhone feed** (Settings tab): subscribe once, and every party and closure shows in your own calendar, updating automatically.
- Dashboard: upcoming parties, booked value, balances owed, overdue balances, money collected, new leads
- Party list with full detail: schedule, receipt, payments
- Record desk payments (card, cash, check) and cancel parties
- Lead tracker: new → contacted → quoted → booked/lost, with follow-up dates
- Reports: revenue by month, plus **vendor order totals** with estimated costs for upcoming parties
- **Pricing tab**: change any price, cost, minimum, lead time, deposit %, balance due days or tax rate, and turn items on/off. No code changes needed, and add-on margins show as you type.
- **Emails tab**: every email sent (or that would be sent), with a preview and a resend button. Staff get alerts for new parties, new leads and overdue balances.
- **Settings tab**: connect QuickBooks Online. Every payment (Stripe or desk) becomes a Sales Receipt under the customer.
- CSV exports for bookings and payments. The payments CSV is laid out for QuickBooks Online import.

## Change prices, hours and packages

**Prices are starting points.** Change them anytime from the admin **Pricing** tab. New bookings use the new prices immediately, and parties already booked keep the price they were quoted.

The starting values, plus party hours, how many parties can run at once, brand colors and email settings, live in **`src/config.js`**. The add-on prices and costs come from the NXGS Birthday Add-Ons working pricing guide (Oct 11, 2026). Costs use the middle of each estimated range.

> ⚠️ Sales tax is set to 8.625% (Nassau County) on every item. Confirm the rate and which items are taxable with your accountant.

## Run it

You need **Node.js 22.13 or newer**. There are no other dependencies, so you don't need to run `npm install`.

```bash
npm run demo     # admin password "demo", payments simulated
npm test         # 22 automated tests
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
| `RESEND_API_KEY` | Turns on email sending (see below). Without it, emails are only recorded in the admin Emails tab. |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_ENVIRONMENT` | QuickBooks Online connection (see below). |

## Connect Stripe

1. In Stripe, go to **Developers → API keys** and copy the secret key into `STRIPE_SECRET_KEY`.
2. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-APP-ADDRESS/webhooks/stripe`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. In **Settings → Customer emails**, turn on "Successful payments" so Stripe emails every customer a receipt.

## Turn on emails

1. Create a free account at [resend.com](https://resend.com) and verify the `nxgs.net` domain. Resend shows the DNS records to add.
2. Create an API key and set `RESEND_API_KEY`.
3. Check the sender and staff alert addresses in `src/config.js` under `emails`.

Reminders are checked every 5 minutes and only go out between 9 AM and 8 PM. Each reminder is sent once.

## Connect QuickBooks Online

1. At [developer.intuit.com](https://developer.intuit.com), create an app with the **Accounting** scope.
2. Under its keys, add the redirect URI `https://YOUR-APP-ADDRESS/quickbooks/callback`.
3. Set `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` and `QBO_ENVIRONMENT=production` (use `sandbox` to test with a sample company), then restart.
4. In Admin → **Settings**, press **Connect QuickBooks** and approve.

Each payment becomes a **Sales Receipt** under the customer, using a "Party Booking" service item, which is created if missing. Payments taken before you connect wait and are sent once you connect. Demo-mode payments are never sent. Each receipt notes how much sales tax it includes, but it's recorded as one non-taxable line, so **ask your accountant how they want deposits and sales tax booked** before connecting the real company file.

## Put it on nxgs.net

Host the app on any Node host (Render, Railway, a small VPS) and point a subdomain at it, e.g. `book.nxgs.net`. Then paste this into the website page. In WordPress, use a **Custom HTML** block:

```html
<div id="nxgs-booking"></div>
<script src="https://book.nxgs.net/static/embed.js" async></script>
```

The booking form resizes itself to fit the page, with no inner scrollbar. Options on the div:
- `data-page="calendar"` shows the live availability calendar, for example on a "Party Calendar" page
- `data-tab="inquiry"` opens on the group & corporate form, for example on a "Corporate Events" page This works the same on Base44 now and WordPress later. You can also link a "Book a Party" button straight to `https://book.nxgs.net/book`.

**Match the new site's look** by setting `brand` in `src/config.js`: main color, accent color, font (any Google Font), logo and corner roundness. Emails use the same logo and color.

## Code layout

```
src/config.js      business settings (prices, hours, packages, vendors)
src/scheduling.js  open time slots and conflict rules
src/pricing.js     quotes, tax, deposit, balance due date
src/bookings.js    bookings, payments, leads, dashboard numbers
src/stripe.js      Stripe Checkout and webhook verification
src/notifications.js  automatic emails and reminders
src/quickbooks.js  QuickBooks Online connection and sync
src/price-settings.js  prices edited from the admin page
src/server.js      web server and pages
public/            booking page, admin page, styles, embed.js
test/              automated tests
```

## Not built yet

- Text-message reminders
- Online refunds (issue them in Stripe for now)
- Multi-facility setup, for selling the app to other facilities or running the Massapequa location
