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
    from: 'NXGS Parties <parties@nxgs.net>', // the domain must be verified in Resend
    replyTo: 'joseph@nxgs.net',
    staffAlerts: ['joseph@nxgs.net'],        // who gets "new booking" / "new lead" alerts
    balanceReminderDaysBefore: 3,            // friendly reminder this many days before the balance is due
    sendBetween: [9, 20],                    // only send reminders between 9 AM and 8 PM facility time
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
      taxable: true,
      description: '2 hours: 60 min field play, 30 min video game room, 30 min party room. Up to 15 kids.',
    },
    {
      id: 'allstar',
      name: 'All-Star Party',
      priceCents: 55000,
      includedKids: 15,
      extraKidCents: 2500,
      taxable: true,
      description: 'Everything in Rookie plus pizza & drinks for the kids and a dedicated party host.',
    },
    {
      id: 'mvp',
      name: 'MVP Party',
      priceCents: 69500,
      includedKids: 15,
      extraKidCents: 2500,
      taxable: true,
      description: 'Everything in All-Star plus a custom shirt for the birthday kid and goodie bags.',
    },
  ],

  // Add-on categories, in the order they appear on the booking page.
  addOnCategories: [
    { id: 'food', name: 'Food' },
    { id: 'favors', name: 'Party favors & keepsakes' },
    { id: 'decor', name: 'Decorations & party extras' },
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
    { id: 'pizza', category: 'food', name: 'Extra pizza pie', unit: 'each', priceCents: 2200, costCents: 1400, minQty: 1, leadDays: 0, vendor: 'Calabria Pizza (North Bellmore)', taxable: true },
    { id: 'hero', category: 'food', name: '3-ft hero (deli)', unit: 'each', priceCents: 7500, costCents: 5000, minQty: 1, leadDays: 3, vendor: "Amia's Deli (East Meadow)", taxable: true },

    // Party favors & keepsakes (items 1–10)
    { id: 'favor-box', category: 'favors', name: 'Clear favor box', detail: 'Photo insert and wrapped treats', unit: 'each', priceCents: 1200, costCents: 500, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'locker-box', category: 'favors', name: 'Mini locker favor box', detail: 'Printed cardstock, filled', unit: 'each', priceCents: 1500, costCents: 600, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'jersey-bag', category: 'favors', name: 'Jersey treat bag', detail: 'Personalized paper bag, filled', unit: 'each', priceCents: 1000, costCents: 400, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'water-bottle', category: 'favors', name: 'Sports water bottle', detail: 'Reusable plastic, personalized', unit: 'each', priceCents: 1600, costCents: 650, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'tumbler', category: 'favors', name: 'Personalized tumbler', detail: 'Acrylic, lid and straw', unit: 'each', priceCents: 2200, costCents: 900, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'mini-ball', category: 'favors', name: 'Mini sports ball', detail: 'Foam, personalized', unit: 'each', priceCents: 1400, costCents: 550, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'drawstring', category: 'favors', name: 'Drawstring bag', detail: 'Personalized fabric bag', unit: 'each', priceCents: 1600, costCents: 650, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'medal', category: 'favors', name: 'MVP medal', detail: 'Metal medal, ribbon and name label', unit: 'each', priceCents: 1000, costCents: 400, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'bag-tag', category: 'favors', name: 'Jersey bag tag', detail: 'Acrylic tag with clip', unit: 'each', priceCents: 1000, costCents: 400, minQty: 12, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'wristbands', category: 'favors', name: 'Wristband set', detail: 'Three sports bands in a sleeve', unit: 'set', priceCents: 900, costCents: 400, minQty: 12, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'shirts', category: 'favors', name: 'Custom party shirt', detail: 'Printed by Lifestyles Sports', unit: 'each', priceCents: 1800, costCents: 900, minQty: 1, leadDays: 14, vendor: 'Lifestyles Sports (Wantagh)', taxable: true },

    // Decorations & party extras (items 11–20)
    { id: 'balloon-tower', category: 'decor', name: 'Balloon tower', detail: 'Approx. 5–6 ft, sports topper', unit: 'each', priceCents: 11000, costCents: 4250, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'centerpiece', category: 'decor', name: 'Balloon table centerpiece', detail: 'Approx. 18–24 inches', unit: 'each', priceCents: 4000, costCents: 1600, minQty: 2, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'poster', category: 'decor', name: 'Athlete poster', detail: 'Personalized 18 × 24 in. print', unit: 'each', priceCents: 5500, costCents: 2000, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'welcome-sign', category: 'decor', name: 'Welcome sign', detail: 'Personalized 18 × 24 in. foam board', unit: 'each', priceCents: 8500, costCents: 3250, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'backdrop', category: 'decor', name: 'Photo backdrop package', detail: 'Printed cover, partial balloon garland, setup', unit: 'setup', priceCents: 29900, costCents: 13000, minQty: 1, leadDays: 28, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'cake-topper', category: 'decor', name: 'Cake topper', detail: 'Layered personalized cardstock', unit: 'each', priceCents: 2200, costCents: 700, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'cupcake-toppers', category: 'decor', name: 'Cupcake toppers', detail: '12 printed sports picks (cupcakes not included)', unit: 'dozen', priceCents: 1500, costCents: 550, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'pennant', category: 'decor', name: 'Birthday pennant', detail: 'Personalized felt-style pennant and stick', unit: 'each', priceCents: 2500, costCents: 950, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'prop-kit', category: 'decor', name: 'Photo prop kit', detail: 'About 10 sports props on sticks', unit: 'kit', priceCents: 4000, costCents: 1600, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
    { id: 'banner', category: 'decor', name: 'Team birthday banner', detail: 'Personalized 3 × 6 ft vinyl banner', unit: 'each', priceCents: 11000, costCents: 4500, minQty: 1, leadDays: 14, vendor: 'NXGS favors & decor', taxable: true },
  ],

  // Non-party events go to an inquiry/lead form; staff follow up with a quote.
  inquiryTypes: [
    { id: 'corporate', name: 'Corporate event' },
    { id: 'adult', name: 'Adult event / league night' },
    { id: 'senior', name: 'Senior event' },
    { id: 'team', name: 'Team skill building' },
    { id: 'other', name: 'Something else' },
  ],
};
