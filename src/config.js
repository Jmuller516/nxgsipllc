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

  // Optional add-ons. vendor = who fulfills it (used for vendor ordering/reports).
  addOns: [
    { id: 'pizza', name: 'Extra pizza pie', vendor: 'Calabria Pizza (North Bellmore)', priceCents: 2200, costCents: 1400, taxable: true },
    { id: 'hero', name: '3-ft hero (deli)', vendor: "Amia's Deli (East Meadow)", priceCents: 7500, costCents: 5000, taxable: true },
    { id: 'shirts', name: 'Custom party shirts (each)', vendor: 'Lifestyles Sports (Wantagh)', priceCents: 1800, costCents: 900, taxable: true },
    { id: 'goodie', name: 'Goodie bag (each)', vendor: 'NXGS', priceCents: 600, costCents: 250, taxable: true },
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
