# NXGS Party App

Party and event booking for **Next Generation Sports Complex**: customers book and pay online, and staff manage everything from one admin page.

## What it does

**Two locations**: NXGS Farmingdale (388 Broad Hollow Rd, Farmingdale, NY 11735) takes bookings now. NXGS Massapequa (400 Carman Mill Rd, Massapequa, NY 11758) is set up for staff only, so customers don't see it yet. Each location has its own calendar, hours, closures, run sheets and reports. Switch locations at the top of the admin page. To open Massapequa to customers, set `public: true` on it in `src/config.js` (`locations`), and a location picker appears on the booking page and calendar.

**For customers**
- **Live availability calendar** (`/calendar`): a month view showing which days are Open, Few left, Booked or Closed. It updates automatically every 30 seconds. Customers tap a day to see open start times, and tapping a time opens the booking form with the date and time filled in. They never see who booked.

- **Chat assistant "Riley"**: a chat bubble on the booking and calendar pages, and a full-page version at `/chat`. It answers questions in a friendly, texting style, checks real availability, quotes exact prices, and books the party, then shows a secure button to pay the deposit. It never takes card numbers in chat. It's labeled as a virtual assistant and, if asked, says it's an AI and offers a call-back from staff. It can also send group/corporate requests and staff follow-ups to your Leads.

**After booking: the family's party page** (`/booking/…`, linked from every email)
- **Party details form**: sport theme, exact name spelling, age, allergies, plus whatever the chosen add-ons need (shirt sizes, jersey number, a photo of the birthday child for the scoreboard, poster or favor boxes). It shows a "complete" badge, and a reminder email goes out 10 days before if anything is missing.
- **Digital invitation**: a link to share by text, email or social media. Guests see the date, time, theme and schedule, add it to their calendar, RSVP with allergies, and sign the waiver right there. The family sees who's coming and whose waiver is missing.
- **Gift cards and party credit** can pay the balance.
- **Referral code**: friends get money off their party, and the family gets party credit when they book.
- **Party page code**: the confirmation email includes a short code (like `K7M2-9QXP`). Parents open `/my-party`, enter the email they booked with plus the code, and land on their party page. A "Can't find your code?" button emails it again. The page opens with a **checklist** (balance, party details, invitations, waivers, review) and **What you're getting**: everything in the package and each add-on. Wrong guesses are limited, and the "email me my code" button never says whether an address has a party.
- **Before you come** card: the address with a directions link, "arrive 10–15 minutes early", where to show the check-in pass, waiver reminder, and your own tips (parking, what to bring, food rules). Write the tips on the admin **Website** tab, one per line. Buttons add the party to Google Calendar or to an Apple/Outlook calendar (a `.ics` file with a reminder the day before).
- **Reminders**: one week before, an email (and a text for families who opted in) lists what is still left: balance, party details, invitations, waivers. Parties booked inside that week skip it.
- **Thank-you with party credit**: a week after the party, an email with a party-credit code ($50 by default, set in `rebook` in `src/config.js`) that works at checkout on the next booking. It is skipped for families who already booked another party.
- **Review** the day after the party: 1 to 5 stars and at least 100 characters (set `reviews.minChars` in `src/config.js`). Only a family with a paid booking can review, once per party, after the party date; the text must be real sentences, not repeated words; and a review shows on the website only if the parent allows it and staff approve it.

**Waivers** (`/waiver`): a liability waiver with a finger-drawn signature, valid for a year per child. Guests sign from the invitation. Walk-ins sign on a front-desk tablet at `/waiver`. ⚠️ The waiver text is a **sample** until you paste in your attorney's or insurer's version (Admin → Settings).

**Partners page** (`/partners`): vendors apply to sell at parties and events, and companies ask about sponsorships. Sponsor inquiries land in Leads.

**Gift cards** (`/gift-cards`): buy online, delivered by email, with a balance check.

**Booking form** (`/book`)
- Pick a kids party package and number of kids (15 included, $25 each extra, max 20)
- See only the start times that are actually open. The scheduler enforces:
  - two parties at once, at most
  - one video game room, never double-booked
  - each package's own schedule: Rookie is 90 minutes (30 min play, 1 sport → 30 min game room → 30 min food, cake & presents); All-Star and MVP are 2 hours (60 min play with 2 sports for All-Star or 3 sports for MVP → 30 → 30)
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
- **What's included**: every package and add-on lists exactly what the customer gets, as bullet points on the package cards and behind a "What's included" link on each add-on. Edit the lists on the Pricing tab, one item per line. Riley uses the same lists when answering questions.
- **Product photos**: every add-on shows a photo on the booking page, and customers can tap it to see it larger. Items show no picture until you upload the real product photo from the Pricing tab (**Add photo** on any item, right from your phone). Photos are resized automatically and kept when you reset prices.
- **Pricing tab**: change any price, cost, minimum, lead time, deposit %, balance due days or tax rate, and turn items on/off. No code changes needed, and add-on margins show as you type.
- **Run sheet** (`/admin/runsheet`, or the button on any calendar day): one printable page per day with each party's host, schedule, theme, add-ons, shirt sizes, allergies in red, balance to collect, and a check-in list showing who still needs a waiver, plus that day's vendor deliveries.
- **Host assignment** on every party.
- **Waivers tab**: search signed waivers and view each one with its signature.
- **Gift cards tab**: every gift card and referral credit with its balance. Issue a card yourself (for example as an apology or a raffle prize) or void one.
- **Reviews tab**: approve which reviews may appear on the website. Only reviews the parent allowed can be shown.
- **Sponsors tab**: add sponsors, upload logos, choose where each logo appears (booking page, calendar, invitations, customer emails) and for which location, set the dates and contract value, and see logo views, clicks and click rate to show sponsors what they're getting. Logos appear only while a sponsor is active and within its dates.
- **Marketplace tab**: outside vendors apply at `/partners` with their products and **their price to NXGS**. You approve them and set your markup (35% by default, or per vendor, or per product, or type an exact price). Live products appear on the booking page under "From our partners", or on the corporate request form. When a family pays, the vendor automatically gets an order email with quantities, personalization and the delivery time (without the family's contact details). You track what you owe each vendor and mark it paid out. The tiles show partner sales, NXGS margin and amount owed.
- **Chats tab**: every chat conversation, with which ones turned into bookings or leads.
- **Messages tab** (emails and texts): every email sent (or that would be sent), with a preview and a resend button. Staff get alerts for new parties, new leads and overdue balances.
- **Settings tab**: connect QuickBooks Online. Every payment (Stripe or desk) becomes a Sales Receipt under the customer.
- CSV exports for bookings and payments. The payments CSV is laid out for QuickBooks Online import.

### Home page, growth and staff tools

- **Home page** (`/`): Sports / Events / Parties in big stadium lettering over the facility photos. Each word swaps the photo and leads to its section; the booking page moved to `/book`.
- **English and Spanish** on the home, booking, party, invitation, waiver and calendar pages, the chat assistant, and customer emails and texts. The family's choice is remembered. Staff pages stay in English. Spanish waiver text is used only once staff paste an attorney-approved one (Settings).
- **Compare packages** table and a **"Make it bigger?"** upgrade suggestion at checkout. Upgrades are tracked.
- **Peak / off-peak start times** (Pricing tab): weekend midday starts cost more, Friday evenings cost less. The price shows on each start-time button.
- **Waitlist**: when a day is full, families join from the booking page (or through the chat). When a time opens (cancellation, expired hold, a moved party, a reopened closure) everyone waiting for that day is emailed, and texted if they agreed.
- **"Your time is still open" email** a few hours after an unpaid hold runs out, with their package, kids and extras pre-filled.
- **Guest family offers**: an unticked-by-default checkbox on RSVPs, waivers and bookings. Two days after a party, guest families who said yes get a "your turn to celebrate" email with the host's referral code. Every one has an unsubscribe link; the list downloads as CSV (Waitlist & offers tab).
- **Highlight video** add-on: staff paste the link on the booking and the family is emailed.
- **Door check-in** (`/admin/checkin`): tap guests in on a tablet, or scan the check-in pass (QR code) each guest gets after RSVPing with any phone camera.
- **Party timer** (`/admin/timer`): live countdown for every party and which room each is in, with a 5-minute warning and an optional chime. "Practice from" runs a pretend clock for training.
- **Self-serve changes**: families move their party once, up to 7 days before, from their party page. They can cancel online, and anything over the deposit is refunded if it's 14+ days out (`changes` in src/config.js). Card refunds go back through Stripe automatically; anything else shows as "refund owed" for staff.
- **Website tab**: real photos (replacing the renderings), a video tour link, the FAQ (shown on the booking page and used by the chat assistant), and Instagram posts.
- **Search page** at `/birthday-parties` (Spanish: `/fiestas-de-cumpleanos`), with Google-readable business, price and FAQ data, plus `/sitemap.xml` and `/robots.txt`. "Copy HTML for WordPress" puts the same content on nxgs.net.
- **Insights tab**: revenue by package, add-on pick rates, when parties happen, how much open time is used, where bookings come from, and what each program (chat, waitlist, emails, offers, upgrades) brought in.
- **Setup tab**: facility name, brand colors, logo, locations and party hours, plus a launch checklist. This is how another facility makes the app its own: each facility runs its own copy and fills in Setup and Pricing; no code changes.

## Change prices, hours and packages

**Prices are starting points.** Change them anytime from the admin **Pricing** tab. New bookings use the new prices immediately, and parties already booked keep the price they were quoted.

The starting values, plus party hours, how many parties can run at once, brand colors and email settings, live in **`src/config.js`**. The add-on prices and costs come from the NXGS Birthday Add-Ons working pricing guide (Oct 11, 2026). Costs use the middle of each estimated range.

> ⚠️ Sales tax is set to 8.625% (Nassau County) on every item. Confirm the rate and which items are taxable with your accountant.

## Run it

You need **Node.js 22.13 or newer**. There are no other dependencies, so you don't need to run `npm install`.

```bash
npm run demo     # admin password "demo", payments simulated
npm test         # 44 automated tests
node tools/build-preview.js   # one-file clickable preview (preview.html)
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
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | Turns on text-message reminders (see below). `TWILIO_MESSAGING_SERVICE_SID` can replace `TWILIO_FROM`. |
| `ANTHROPIC_API_KEY` | Turns on the chat assistant (see below). |
| `ASSISTANT_MODEL` | Optional. Defaults to `claude-haiku-5-5` (fast and low-cost). |
| `RESEND_API_KEY` | Turns on email sending (see below). Without it, emails are only recorded in the admin Emails tab. |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_ENVIRONMENT` | QuickBooks Online connection (see below). |

## Connect Stripe

1. In Stripe, go to **Developers → API keys** and copy the secret key into `STRIPE_SECRET_KEY`.
2. Go to **Developers → Webhooks → Add endpoint**:
   - URL: `https://YOUR-APP-ADDRESS/webhooks/stripe`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. In **Settings → Customer emails**, turn on "Successful payments" so Stripe emails every customer a receipt.

## Turn on the chat assistant

1. Create an account at [platform.claude.com](https://platform.claude.com), add billing, and create an API key.
2. Set `ANTHROPIC_API_KEY` and restart. The chat bubble appears on the booking and calendar pages.

The assistant's name, and the model it uses, are in `src/config.js` under `assistant`. It always uses the live prices, add-ons, hours and availability, so price changes on the Pricing tab apply to the chat right away. Built-in limits: 1,000 characters per message, 60 messages per conversation, 40 messages per visitor every 10 minutes, and 3 bookings per conversation. Unpaid chat bookings release their time after 30 minutes, the same as the form.

To put the chat on nxgs.net by itself, add `<script src="https://book.nxgs.net/static/chat.js" defer></script>`, or use the embed with `data-page="chat"`.

## Before taking on vendors and sponsors

- Have a short **vendor agreement**: pricing, delivery, quality, food-safety rules for edible items, cancellations, and the payout terms (Net 15 by default, set in `src/config.js` → `marketplace`). Ask for a certificate of insurance. The app records whether the vendor says they're insured, but doesn't verify it.
- NXGS sells partner products to the customer, so **NXGS collects the sales tax** on them, the same as your own add-ons. Ask your accountant how to record vendor payouts.
- Sponsorship packages and starting prices are in `src/config.js` → `sponsorPackages`. Use a simple sponsorship agreement for terms and logo usage rights.

## Turn on text messages

1. Create a [Twilio](https://www.twilio.com) account and buy a local number.
2. For texting customers in the US, Twilio requires **A2P 10DLC registration** of your business and use case ("appointment reminders"). Approval usually takes a few days.
3. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` (your number, e.g. `+15165550100`), then restart.

Texts go only to families who check "Text me reminders" when booking: the booking confirmation, the balance reminder, and a day-before reminder that also mentions any missing waivers. Every text ends with "Reply STOP to opt out", and Twilio handles STOP automatically.

## Before using waivers with real customers

Paste your attorney- or insurer-approved waiver into Admin → Settings → Waiver text. Each signature stores the exact version that was signed, the signer's typed name, a drawn signature, the date and time, and the device's IP address.

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
src/assistant.js   chat assistant (Claude API + booking tools)
src/guests.js      invitations, RSVPs and waivers
src/gifts.js       gift cards and referral credits
src/reviews.js     post-party reviews
src/media.js       uploaded images (photos, signatures)
src/sponsors.js    sponsors, placements, views and clicks
src/marketplace.js outside vendors, partner products, markup, orders and payouts
src/notifications.js  automatic emails and reminders
src/quickbooks.js  QuickBooks Online connection and sync
src/price-settings.js  prices edited from the admin page
src/server.js      web server and pages
public/            booking page, admin page, styles, embed.js
test/              automated tests
```

## Not built yet

- Online refunds (issue them in Stripe for now)
- Different prices per location (both locations share one price list today)
- Vendor log-in portal (vendors work by email today)
- Selling the app to other facilities (multi-company setup)
