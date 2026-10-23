// NXGS Party App — business settings.
// Every price here is a WORKING MODEL. Change numbers here; nothing else needs editing.
// Money is stored in cents to avoid rounding errors.

module.exports = {
  business: {
    name: 'Next Generation Sports Complex',
    shortName: 'NXGS',
    partyVendor: 'Sports Party Events LLC', // SPE LLC, NXGS's party vendor
    website: 'https://www.nxgs.net',
    email: 'joseph@nxgs.net',
    timezone: 'America/New_York',
    address: '388 Broad Hollow Rd, Farmingdale, NY 11735',   // main address (Farmingdale)
    tagline: 'a new indoor sports complex in Farmingdale, NY', // how the chat assistant describes the facility
    phone: null,                  // front desk number shown to customers, e.g. '(516) 555-0100'
  },

  // Look & feel. Change these to match the new nxgs.net design.
  brand: {
    primaryColor: '#0b4fd6',      // buttons, selected items
    accentColor: '#ff7a1a',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    googleFont: null,             // e.g. 'Montserrat:wght@400;600;700' to load from Google Fonts
    logoUrl: null,                // e.g. 'https://www.nxgs.net/logo.png' — shown on booking page & emails
    cornerRadius: 14,             // px; 0 for square corners
  },

  // Automatic emails. Sending turns on when RESEND_API_KEY is set (see README).
  emails: {
    weekAheadDays: 7,            // "one week to go" email and text, with what's left to do
    from: 'NXGS Parties <parties@nxgs.net>', // the domain must be verified in Resend
    replyTo: 'joseph@nxgs.net',
    staffAlerts: ['joseph@nxgs.net'],        // who gets "new booking" / "new lead" alerts
    balanceReminderDaysBefore: 3,            // friendly reminder this many days before the balance is due
    sendBetween: [9, 20],                    // only send reminders between 9 AM and 8 PM facility time
  },

  // Chat assistant (turns on when ANTHROPIC_API_KEY is set). It is an AI and says so if asked.
  assistant: {
    name: 'Riley',
    model: 'claude-haiku-5-5',   // fast and low-cost; ASSISTANT_MODEL overrides
  },

  // QuickBooks Online. Connect from the admin page once QBO_CLIENT_ID / QBO_CLIENT_SECRET are set.
  quickbooks: {
    itemName: 'Party Booking',               // QBO product/service each payment is recorded under (created if missing)
    incomeAccountName: 'Sales',              // income account for that item if it has to be created
    depositToAccountName: null,              // e.g. 'Undeposited Funds'; null = QuickBooks default
  },

  payments: {
    currency: 'usd',
    depositPercent: 25,          // non-refundable deposit taken at booking
    depositRefundable: false,
    balanceDueDaysBefore: 7,     // remaining balance due this many days before the party
    // If the party is sooner than balanceDueDaysBefore, the full amount is charged at booking.
    holdMinutes: 30,             // unpaid bookings hold the time slot this long, then release
  },

  // Sales tax. NXGS's tax exemption covers the build-out only, not what it sells.
  // CONFIRM the rate and which items are taxable with your accountant.
  tax: {
    rate: 0.08625, // Nassau County, NY combined rate
    label: 'NY sales tax',
  },

  // Kids party format: 60 min play, 30 min video game room, 30 min food.
  party: {
    phases: [
      { key: 'play', label: 'Field play', minutes: 60 },
      { key: 'gameRoom', label: 'Video game room', minutes: 30, exclusive: true }, // only one game room
      { key: 'food', label: 'Food & cake', minutes: 30 },
    ],
    maxConcurrentParties: 2,     // two parties at a time
    turnoverMinutes: 15,         // cleanup time after a party before the space is reused
    slotIntervalMinutes: 30,     // start times offered every 30 minutes
    maxKids: 20,
  },

  // Hours parties can run (party must END by close). 0 = Sunday ... 6 = Saturday.
  // null = no parties that day.
  partyHours: {
    0: { open: '10:00', close: '19:00' },
    1: null,
    2: null,
    3: null,
    4: null,
    5: { open: '16:00', close: '21:00' },
    6: { open: '10:00', close: '20:00' },
  },
  minDaysAhead: 2,     // earliest bookable date (days from today)
  maxDaysAhead: 180,   // latest bookable date

  packages: [
    {
      id: 'rookie',
      name: 'Rookie Party',
      priceCents: 45000,
      includedKids: 15,
      extraKidCents: 2500,
      // Rookie is 90 minutes; the other packages use the standard 2-hour schedule above.
      phases: [
        { key: 'play', label: 'Field play (1 sport)', minutes: 30 },
        { key: 'gameRoom', label: 'Video game room', minutes: 30, exclusive: true },
        { key: 'food', label: 'Food, cake & presents', minutes: 30 },
      ],
      includes: "30 minutes of field play (1 sport)\n30 minutes in the video game room\n30 minutes in the party room for food, cake and presents\nTables, chairs and setup\nCleanup after the party",
      taxable: true,
      description: '90 minutes: 30 min field play (1 sport), 30 min video game room, 30 min food, cake & presents. Up to 15 kids.',
      features: { sports: 1, gameRoom: true, pizza: false, host: false, shirts: false, goodieBags: false },
    },
    {
      id: 'allstar',
      name: 'All-Star Party',
      priceCents: 55000,
      includedKids: 15,
      extraKidCents: 2500,
      phases: [
        { key: 'play', label: 'Field play (2 sports)', minutes: 60 },
        { key: 'gameRoom', label: 'Video game room', minutes: 30, exclusive: true },
        { key: 'food', label: 'Food, cake & presents', minutes: 30 },
      ],
      includes: "2 hours: 60 minutes of field play (2 sports)\n30 minutes in the video game room\n30 minutes in the party room for food, cake and presents\nPizza from Calabria Pizza for the kids\nDrinks for the kids\nA dedicated NXGS party host\nTables, chairs, setup and cleanup",
      taxable: true,
      description: '2 hours: 60 min field play (2 sports), 30 min video game room, 30 min food, cake & presents, plus pizza, drinks and a dedicated party host.',
      features: { sports: 2, gameRoom: true, pizza: true, host: true, shirts: false, goodieBags: false },
      upgradePitch: '2 sports, a full 2 hours, pizza and drinks, and a dedicated party host', // shown to Rookie bookers
    },
    {
      id: 'mvp',
      name: 'MVP Party',
      priceCents: 69500,
      includedKids: 15,
      extraKidCents: 2500,
      phases: [
        { key: 'play', label: 'Field play (3 sports)', minutes: 60 },
        { key: 'gameRoom', label: 'Video game room', minutes: 30, exclusive: true },
        { key: 'food', label: 'Food, cake & presents', minutes: 30 },
      ],
      includes: "2 hours: 60 minutes of field play (3 sports)\n30 minutes in the video game room\n30 minutes in the party room for food, cake and presents\nPizza from Calabria Pizza and drinks for the kids\nA dedicated NXGS party host\nPrinted party shirt for every child (one-color print by Lifestyles Sports; sizes collected after booking)\nSpecial shirt for the birthday child (multi-color, or an extra design on the back)\nShirts need 2 weeks to print: parties booked less than 2 weeks out need Rush shirt printing\nGoodie bag for every child (contents to be confirmed)\nTables, chairs, setup and cleanup",
      taxable: true,
      description: '2 hours: 60 min field play (3 sports), 30 min video game room, 30 min food, cake & presents, plus pizza, drinks, a party host, a one-color printed shirt for every child (special one for the birthday child) and goodie bags.',
      shirtsForAll: true, // one printed shirt per child; sizes go on the party details form
      shirtLeadDays: 14, // inside this, shirts are only included with the shirt-rush add-on
      features: { sports: 3, gameRoom: true, pizza: true, host: true, shirts: true, goodieBags: true },
      upgradePitch: '3 sports, a printed shirt for every child and goodie bags', // shown to All-Star bookers
    },
  ],

  // Rows of the "Compare packages" table on the booking page (values come from each package's features).
  compareRows: [
    { key: 'length', label: 'Party length' },
    { key: 'sports', label: 'Sports during field play' },
    { key: 'gameRoom', label: 'Video game room' },
    { key: 'pizza', label: 'Pizza & drinks for the kids' },
    { key: 'host', label: 'Dedicated party host' },
    { key: 'shirts', label: 'Printed shirt for every child' },
    { key: 'goodieBags', label: 'Goodie bag for every child' },
  ],

  // Peak and off-peak pricing by start time (starting points; edit in Admin → Pricing).
  // A party whose START time falls in a window gets that amount added (negative = discount).
  timePricing: [
    { id: 'prime', label: 'Prime time (weekend midday)', days: [0, 6], from: '11:00', to: '14:30', adjustCents: 5000 },
    { id: 'friday', label: 'Friday evening savings', days: [5], from: '16:00', to: '21:00', adjustCents: -5000 },
  ],

  // Families changing or cancelling from their booking page. Starting points: confirm with your policy.
  changes: {
    rescheduleMinDays: 7,          // self-serve date changes up to this many days before the party
    freeReschedules: 1,            // after this many, the page asks them to contact staff
    cancelRefundMinDays: 14,       // cancel at least this many days out: everything except the deposit is refunded
  },

  // Follow-ups that win back bookings.
  recovery: { afterHours: 3, withinDays: 3 },   // "your time is still open" email after an unpaid hold expires
  guestOffer: {
    enabled: true,
    daysAfterParty: 2,             // sent to guest families who opted in, this many days after the party
    programsText: 'camps, clinics and leagues',
    programsUrl: null,             // e.g. 'https://www.nxgs.net/programs'
  },

  // Common questions shown on the booking page, the search landing page, and known to the chat assistant.
  // Answers marked draft: true are hidden until staff fill them in (Admin → Website).
  faq: [
    // auto: the answer is written from the current settings, so it stays right when prices or policies change.
    { q: 'How long is a party?', auto: 'length' },
    { q: 'How many kids can come?', auto: 'kids' },
    { q: 'How do payments work?', auto: 'payments' },
    { q: 'Do guests need a waiver?', a: 'Yes. Every child who plays needs a waiver signed by a parent or guardian. Guests sign online through your invitation link, and a waiver is good for a year.' },
    { q: 'What should kids wear?', a: 'Sneakers and comfortable clothes they can run in.' },
    { q: 'When should we arrive?', a: 'Please arrive 10 to 15 minutes before your start time.' },
    { q: 'Can we change or cancel?', auto: 'changes' },
    { q: 'Can we bring our own cake and food?', a: '', draft: true },
    { q: 'Can parents stay and watch?', a: '', draft: true },
    { q: 'Where do we park?', a: '', draft: true },
  ],

  // The search-friendly birthday party page (/birthday-parties). Edit in Admin → Website.
  seo: {
    pageTitle: 'Kids Birthday Parties in Farmingdale, NY',
    headline: 'Sports birthday parties in Farmingdale',
    intro: 'Turf field games, a video game room and a private party room, with a party host to run it all. Pick your package and book online in minutes.',
    areas: ['Farmingdale', 'Bethpage', 'Plainview', 'Melville', 'Massapequa', 'Wantagh', 'Levittown', 'Hicksville'],
  },

  // Languages customers can pick on the booking pages, emails and chat.
  languages: ['en', 'es'],

  // Add-on categories, in the order they appear on the booking page.
  addOnCategories: [
    { id: 'food', name: 'Food' },
    { id: 'favors', name: 'Party favors & keepsakes' },
    { id: 'decor', name: 'Decorations & party extras' },
    { id: 'fun', name: 'Entertainment & upgrades' },
    { id: 'partners', name: 'From our partners' },   // approved outside vendors (Admin → Marketplace)
  ],

  // Optional add-ons.
  //   unit       — shown after the price ("$12 each", "$15/dozen")
  //   minQty     — smallest order allowed (0 = not ordered)
  //   leadDays   — calendar days needed before the party; the item is unavailable for sooner parties
  //   costCents  — estimated NXGS cost (midpoint of the planning range) for margin & vendor reports; never shown to customers
  //   vendor     — who fulfills it (vendor order report)
  // Favors & decor are from the "NXGS Birthday Add-Ons" working pricing guide (Oct 11, 2026) — planning
  // estimates, not confirmed supplier quotes. Lead times follow its booking policy: two weeks for printed
  // favors & decorations, four weeks for custom merchandise (15–20 day items) and the photo backdrop.
  addOns: [
    // Food
    { id: 'pizza', category: 'food', name: 'Extra pizza pie', unit: 'each', priceCents: 2200, costCents: 1400, minQty: 1, leadDays: 0, vendor: 'Calabria Pizza (North Bellmore)', taxable: true, includes: "One large pizza pie from Calabria Pizza in North Bellmore\nAbout 8 slices\nDelivered hot for the food & cake portion" },
    { id: 'hero', category: 'food', name: '3-ft hero (deli)', unit: 'each', priceCents: 7500, costCents: 5000, minQty: 1, leadDays: 3, vendor: "Amia's Deli (East Meadow)", taxable: true, includes: "3-foot hero from Amia's Deli in East Meadow\nServes about 12\u201315 people" },

    { id: 'bagels', category: 'food', name: 'Bagel platter', detail: 'For morning parties', unit: 'dozen', priceCents: 3500, costCents: 1800, minQty: 1, leadDays: 3, vendor: 'TBD', taxable: true,
      includes: "A dozen assorted bagels, sliced\nCream cheese and butter\nPlates, napkins and knives" },
    { id: 'coffee', category: 'food', name: 'Coffee for the parents', detail: 'Box of hot coffee', unit: 'box', priceCents: 3000, costCents: 1600, minQty: 1, leadDays: 3, vendor: 'TBD', taxable: true,
      includes: "Box of hot coffee, about 10\u201312 cups\nCups, milk, sugar and stirrers" },

    // Party favors & keepsakes (items 1–10)
    { id: 'favor-box', category: 'favors', name: 'Clear favor box', detail: 'Photo insert and wrapped treats', unit: 'each', priceCents: 1200, costCents: 500, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Clear favor box\nPhoto insert of the birthday child\nFilled with assorted wrapped treats" },
    { id: 'locker-box', category: 'favors', name: 'Mini locker favor box', detail: 'Printed cardstock, filled', unit: 'each', priceCents: 1500, costCents: 600, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Mini locker-shaped box in printed cardstock\nPrinted with the party design\nFilled with assorted wrapped treats" },
    { id: 'jersey-bag', category: 'favors', name: 'Jersey treat bag', detail: 'Personalized paper bag, filled', unit: 'each', priceCents: 1000, costCents: 400, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Paper treat bag printed to look like a jersey\nPersonalized with the name\nFilled with assorted wrapped treats" },
    { id: 'water-bottle', category: 'favors', name: 'Sports water bottle', detail: 'Reusable plastic, personalized', unit: 'each', priceCents: 1600, costCents: 650, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true, includes: "Reusable plastic sports water bottle\nPersonalized with a name" },
    { id: 'tumbler', category: 'favors', name: 'Personalized tumbler', detail: 'Acrylic, lid and straw', unit: 'each', priceCents: 2200, costCents: 900, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true, includes: "Acrylic tumbler with lid and straw\nPersonalized with a name" },
    { id: 'mini-ball', category: 'favors', name: 'Mini sports ball', detail: 'Foam, personalized', unit: 'each', priceCents: 1400, costCents: 550, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true, includes: "Foam mini sports ball\nPersonalized" },
    { id: 'drawstring', category: 'favors', name: 'Drawstring bag', detail: 'Personalized fabric bag', unit: 'each', priceCents: 1600, costCents: 650, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true, includes: "Fabric drawstring bag\nPersonalized with a name" },
    { id: 'medal', category: 'favors', name: 'MVP medal', detail: 'Metal medal, ribbon and name label', unit: 'each', priceCents: 1000, costCents: 400, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Metal medal on a ribbon\nName label" },
    { id: 'bag-tag', category: 'favors', name: 'Jersey bag tag', detail: 'Acrylic tag with clip', unit: 'each', priceCents: 1000, costCents: 400, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Acrylic bag tag with clip\nPersonalized with a name and number" },
    { id: 'wristbands', category: 'favors', name: 'Wristband set', detail: 'Three sports bands in a sleeve', unit: 'set', priceCents: 900, costCents: 400, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true, includes: "Set of three sports wristbands\nPackaged in a sleeve" },
    { id: 'shirts', category: 'favors', name: 'Custom party shirt', detail: 'Printed by Lifestyles Sports', unit: 'each', priceCents: 1800, costCents: 900, minQty: 1, leadDays: 14, rushable: true, vendor: 'Lifestyles Sports (Wantagh)', taxable: true, includes: "Custom printed party t-shirt\nPrinted by Lifestyles Sports in Wantagh\nSizes collected after booking" },
    { id: 'shirt-rush', category: 'favors', name: 'Rush shirt printing', detail: 'For parties less than 2 weeks away', unit: 'party', priceCents: 7500, minQty: 1, maxQty: 1, onlyWithinDays: 14, vendor: 'Lifestyles Sports (Wantagh)', taxable: true,
      includes: "Rush printing so shirts are ready for the party\nNeeded for MVP Party shirts or custom party shirts when the party is less than 2 weeks away\nWe confirm the rush with our printer after you book" },

    // Decorations & party extras (items 11–20)
    { id: 'balloon-tower', category: 'decor', name: 'Balloon tower', detail: 'Approx. 5–6 ft, sports topper', unit: 'each', priceCents: 11000, costCents: 4250, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Balloon column about 5\u20136 feet tall\nSports ball topper\nSet up at NXGS before the party" },
    { id: 'centerpiece', category: 'decor', name: 'Balloon table centerpiece', detail: 'Approx. 18–24 inches', unit: 'each', priceCents: 4000, costCents: 1600, minQty: 2, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Balloon table centerpiece about 18\u201324 inches tall\nOne per table" },
    { id: 'poster', category: 'decor', name: 'Athlete poster', detail: 'Personalized 18 × 24 in. print', unit: 'each', priceCents: 5500, costCents: 2000, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Personalized 18 \u00d7 24 inch athlete poster\nPaper print with the child's name and photo" },
    { id: 'welcome-sign', category: 'decor', name: 'Welcome sign', detail: 'Personalized 18 × 24 in. foam board', unit: 'each', priceCents: 8500, costCents: 3250, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Personalized 18 \u00d7 24 inch welcome sign\nFoam board, displayed on an easel at the entrance" },
    { id: 'backdrop', category: 'decor', name: 'Photo backdrop package', detail: 'Printed cover, partial balloon garland, setup', unit: 'setup', priceCents: 29900, costCents: 13000, minQty: 1, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true, includes: "Printed photo backdrop\nPartial balloon garland\nSet up by NXGS before the party" },
    { id: 'cake-topper', category: 'decor', name: 'Cake topper', detail: 'Layered personalized cardstock', unit: 'each', priceCents: 2200, costCents: 700, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Layered cardstock cake topper\nPersonalized with the name and age\nCake not included" },
    { id: 'cupcake-toppers', category: 'decor', name: 'Cupcake toppers', detail: '12 printed sports picks (cupcakes not included)', unit: 'dozen', priceCents: 1500, costCents: 550, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "12 printed sports-themed cupcake picks\nCupcakes not included" },
    { id: 'pennant', category: 'decor', name: 'Birthday pennant', detail: 'Personalized felt-style pennant and stick', unit: 'each', priceCents: 2500, costCents: 950, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Felt-style birthday pennant on a stick\nPersonalized with the name" },
    { id: 'prop-kit', category: 'decor', name: 'Photo prop kit', detail: 'About 10 sports props on sticks', unit: 'kit', priceCents: 4000, costCents: 1600, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "About 10 sports-themed photo props on sticks" },
    { id: 'banner', category: 'decor', name: 'Team birthday banner', detail: 'Personalized 3 × 6 ft vinyl banner', unit: 'each', priceCents: 11000, costCents: 4500, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true, includes: "Personalized 3 \u00d7 6 foot vinyl banner\nHung in the party room" },

    // Entertainment & upgrades
    { id: 'scoreboard', category: 'fun', name: 'Video scoreboard birthday feature', detail: 'The birthday child on the big screen', unit: 'party', priceCents: 7500, costCents: 0, minQty: 1, maxQty: 1, leadDays: 3, vendor: 'NXGS', taxable: true,
      includes: "Birthday child's name and photo on the video scoreboard\nHappy-birthday message during field play\nSend us a photo after booking" },
    { id: 'highlight-video', category: 'fun', name: 'Party highlight video', detail: 'A short clip of the party to keep and share', unit: 'party', priceCents: 4900, costCents: 0, minQty: 1, maxQty: 1, leadDays: 0, vendor: 'NXGS', taxable: true,
      includes: "A 30\u201360 second highlight clip of the party\nClips from field play and the birthday moment\nSent to you by link within a few days after the party" },
    { id: 'bounce-house', category: 'fun', name: 'Bounce house rental', detail: 'Inflatable for the party', unit: 'party', priceCents: 25000, costCents: 15000, minQty: 1, maxQty: 1, leadDays: 7, vendor: 'TBD', taxable: true,
      includes: "Inflatable bounce house for the length of the party\nDelivered, set up and taken down for you" },
  ],

  // Non-party events go to an inquiry/lead form; staff follow up with a quote.
  // Locations. Customers only see locations with public: true. Staff see all of them in Admin.
  // Each location has its own calendar, closures, run sheets and reports.
  // partyHours / maxConcurrentParties left out = use the defaults above.
  locations: [
    { id: 'farmingdale', name: 'NXGS Farmingdale', shortName: 'Farmingdale', address: '388 Broad Hollow Rd, Farmingdale, NY 11735', phone: null, public: true, entity: 'Next Generation Sports Complex LLC',
      partyHours: { 0: { open: '10:00', close: '19:00' }, 1: null, 2: null, 3: null, 4: null, 5: { open: '16:00', close: '21:00' }, 6: { open: '10:00', close: '20:00' } } },
    // Massapequa: same weekend hours as Farmingdale, plus weekday parties.
    // Weekday times (Mon–Thu 4–9 PM) are a placeholder until confirmed.
    { id: 'massapequa', name: 'NXGS Massapequa', shortName: 'Massapequa', address: '400 Carman Mill Rd, Massapequa, NY 11758', phone: null, public: false, entity: 'NXGS2 LLC',
      partyHours: { 0: { open: '10:00', close: '19:00' }, 1: { open: '16:00', close: '21:00' }, 2: { open: '16:00', close: '21:00' }, 3: { open: '16:00', close: '21:00' }, 4: { open: '16:00', close: '21:00' }, 5: { open: '16:00', close: '21:00' }, 6: { open: '10:00', close: '20:00' } } },
  ],
  defaultLocation: 'farmingdale',

  // Sponsorship packages you can sell. Prices are starting points.
  // Placements: booking (booking page), calendar, invite (every party invitation), email (customer emails), runsheet (staff only).
  sponsorPackages: [
    { id: 'presenting', name: 'Presenting party sponsor', placements: ['booking', 'calendar', 'invite', 'email'], suggestedMonthlyCents: 50000, description: 'Logo and "Parties presented by" on the booking page, calendar, every invitation and every customer email.' },
    { id: 'invitations', name: 'Invitation sponsor', placements: ['invite'], suggestedMonthlyCents: 25000, description: 'Logo on every digital party invitation guests open.' },
    { id: 'booking', name: 'Booking page sponsor', placements: ['booking', 'calendar'], suggestedMonthlyCents: 20000, description: 'Logo on the booking page and availability calendar.' },
    { id: 'scoreboard', name: 'Video scoreboard spot', placements: [], suggestedMonthlyCents: 30000, description: 'Ad on the video scoreboard during parties (shown in the building).' },
    { id: 'goodie-bag', name: 'Goodie bag insert', placements: [], suggestedMonthlyCents: 15000, description: 'Sponsor flyer, coupon or sample in party goodie bags.' },
  ],

  // Outside vendors who sell through NXGS (Admin → Marketplace).
  marketplace: {
    defaultMarkupPercent: 35,     // NXGS markup on the vendor's price unless set per vendor or product
    payoutTerms: 'Net 15 after the party',
  },

  // Things customers can add to an event inquiry. Food and drinks come through our catering partners (outside catering only).
  eventItems: {
    cardshow: ['Card sleeves', 'protective cases', 'binders', 'display stands', 'NXGS merchandise', 'snacks', 'drinks'],
    market: ['NXGS apparel', 'reusable shopping bags', 'seasonal gift baskets', 'personalized gifts', 'coffee', 'refreshments'],
    celebration: ['Party packages', 'pizza', 'drinks', 'cakes (bakery partner)', 'balloon towers', 'personalized gift bags', 'custom shirts', 'cups', 'engraved favors'],
    corporate: ['Catering packages', 'coffee service', 'branded shirts', 'notebooks', 'pens', 'water bottles', 'employee gift packages'],
    teambuilding: ['Catering packages', 'coffee service', 'branded shirts', 'water bottles', 'employee gift packages'],
    networking: ['Coffee', 'breakfast items', 'appetizers', 'drinks', 'notebooks', 'pens', 'NXGS merchandise'],
    expo: ['Food', 'drinks', 'reusable tote bags', 'lanyards', 'notebooks', 'phone chargers', 'event merchandise'],
    gaming: ['Gaming snacks', 'drinks', 'tournament shirts', 'mouse pads', 'controller grips', 'charging cables', 'collectible merchandise'],
    watchparty: ['Pizza', 'wings', 'pretzels', 'popcorn', 'nachos', 'drinks', 'NXGS fan shirts', 'souvenir cups'],
    trivia: ['Shareable snack platters', 'pizza', 'desserts', 'drinks', 'themed shirts', 'souvenir cups'],
    movie: ['Popcorn', 'candy', 'drinks', 'pizza', 'blankets', 'glow bracelets', 'family snack bundles'],
    entertainment: ['Appetizers', 'snack baskets', 'desserts', 'drinks', 'event shirts or posters (with the performer’s approval)'],
    school: ['Refreshments', 'photo prints', 'custom class shirts', 'graduation gifts', 'personalized tumblers', 'party favors'],
    fundraiser: ['Food', 'drinks', 'cause-themed shirts', 'bracelets', 'personalized gifts', 'merchandise bundles benefiting the organization'],
    banquet: ['Meal packages', 'trophies', 'medals', 'plaques', 'engraved gifts', 'team shirts', 'personalized water bottles'],
    workshop: ['Activity kits', 'art supplies', 'project materials', 'workbooks', 'aprons', 'snacks', 'take-home kits'],
  },

  inquiryTypes: [
    { id: 'corporate', name: 'Company outing / corporate event' },
    { id: 'teambuilding', name: 'Team-building day' },
    { id: 'expo', name: 'Sports expo / trade show', vendors: true },
    { id: 'cardshow', name: 'Baseball card / collectibles show', vendors: true },
    { id: 'market', name: 'Vendor market / pop-up', vendors: true },
    { id: 'networking', name: 'Business networking event' },
    { id: 'celebration', name: 'Milestone party (Sweet 16, bar/bat mitzvah, graduation, anniversary)' },
    { id: 'gaming', name: 'Video game tournament / esports' },
    { id: 'watchparty', name: 'Sports watch party' },
    { id: 'trivia', name: 'Trivia, music bingo or game night' },
    { id: 'movie', name: 'Family movie night' },
    { id: 'entertainment', name: 'Comedy or live entertainment night' },
    { id: 'banquet', name: 'Awards banquet / team dinner' },
    { id: 'workshop', name: 'Workshop / class / seminar' },
    { id: 'tournament', name: 'Tournament / league' },
    { id: 'fundraiser', name: 'Fundraiser / charity event' },
    { id: 'school', name: 'School dance, camp or youth group' },
    { id: 'adult', name: 'Adult event / league night' },
    { id: 'senior', name: 'Senior event' },
    { id: 'team', name: 'Team skill building' },
    { id: 'other', name: 'Something else' },
    { id: 'sponsor', name: 'Sponsorship inquiry', hidden: true },   // from the Partners page
  ],

  // Sport themes parents can pick. Used on invitations, the details form and the staff run sheet.
  themes: [
    { id: 'soccer', name: 'Soccer', emoji: '⚽', color: '#1f9d55' },
    { id: 'baseball', name: 'Baseball', emoji: '⚾', color: '#c0392b' },
    { id: 'softball', name: 'Softball', emoji: '🥎', color: '#d4a017' },
    { id: 'basketball', name: 'Basketball', emoji: '🏀', color: '#e67e22' },
    { id: 'football', name: 'Football', emoji: '🏈', color: '#7b4a2a' },
    { id: 'lacrosse', name: 'Lacrosse', emoji: '🥍', color: '#2c6db5' },
    { id: 'cheer', name: 'Cheer', emoji: '📣', color: '#c2185b' },
    { id: 'all-sports', name: 'All-sports mix', emoji: '🏆', color: '#0b4fd6' },
  ],

  // Liability waivers. The text below is a SAMPLE ONLY — replace it (Admin → Settings) with the waiver
  // your attorney or insurance carrier gives you before using it with real customers.
  waiver: {
    validDays: 365,
    title: 'Participant Waiver and Release',
    sampleText: [
      'SAMPLE WAIVER: replace this text with the waiver provided by your attorney or insurance carrier.',
      'I am the parent or legal guardian of the child named below. I understand that sports and play activities at Next Generation Sports Complex involve physical activity and a risk of injury.',
      'I agree that my child will follow staff instructions and facility rules.',
      'I confirm that my child is in good health and able to take part, and I have listed any medical conditions or allergies staff should know about.',
      'I authorize staff to seek emergency medical care for my child if I cannot be reached.',
      'I give permission for photos taken during events to be used by the facility unless I tell staff otherwise.',
    ].join('\n\n'),
  },

  // Referral program: a family that books shares their code.
  referral: {
    friendDiscountCents: 2500,   // the new family gets this off their party
    referrerCreditCents: 2500,   // the family who shared the code gets this as party credit
  },

  giftCards: {
    presetCents: [5000, 10000, 25000],
    minCents: 2500,
    maxCents: 100000,
  },

  // Thank-you after the party with party credit toward the next one. Change the amount here.
  rebook: { enabled: true, afterDays: 7, creditCents: 5000 },

  reviews: {
    minChars: 100,               // a review must say at least this much (keeps out drive-by and fake reviews)
    minWords: 10,
    askDaysAfter: 1,             // review request goes out this many days after the party
    googleReviewUrl: null,       // e.g. your Google Business "write a review" link; offered after 4–5 star reviews
  },

  // Party details form: which add-ons need what from the parent.
  details: {
    shirtSizes: ['YXS', 'YS', 'YM', 'YL', 'YXL', 'AS', 'AM', 'AL', 'AXL', 'A2XL'],
    needsPhoto: ['scoreboard', 'poster', 'favor-box'],
    needsJerseyNumber: ['jersey-bag', 'bag-tag', 'locker-box'],
  },
};
