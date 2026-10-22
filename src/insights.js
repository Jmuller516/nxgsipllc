// Owner insights: what sells, what fills, and where bookings come from.
// Everything is computed from the bookings table, so it's always current.

const config = require('./config');
const scheduling = require('./scheduling');
const { addDays, daysBetween } = require('./pricing');

const SOURCE_NAMES = { web: 'Booking page', website: 'nxgs.net', chat: 'Chat assistant', waitlist: 'Waitlist', recovery: 'Abandoned-booking email', 'guest-offer': 'Guest family offer', referral: 'Referral code', admin: 'Staff' };

function createInsights(db, svc, opts = {}) {
  const cfg = opts.config || config;

  /** @param {{from, to, locationId}} range party dates, inclusive */
  function report({ from, to, locationId } = {}) {
    const today = svc.todayLocal();
    from = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : addDays(today, -90);
    to = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : addDays(today, 180);
    const all = svc.list({ from, to, locationId: locationId || undefined });
    const live = all.filter((b) => ['confirmed', 'paid'].includes(b.status));
    const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const revenue = sum(live, (b) => b.total_cents);

    // Packages
    const byPackage = cfg.packages.map((p) => {
      const rows = live.filter((b) => b.package_id === p.id);
      const rev = sum(rows, (b) => b.total_cents);
      return { id: p.id, name: p.name, parties: rows.length, revenueCents: rev, avgCents: rows.length ? Math.round(rev / rows.length) : 0, share: live.length ? rows.length / live.length : 0 };
    });

    // Add-ons: how often each is picked
    const addOns = {};
    for (const b of live) for (const l of b.quote.lines.filter((x) => x.kind === 'addon')) {
      const a = (addOns[l.id] ||= { id: l.id, name: l.name, parties: 0, units: 0, revenueCents: 0, costCents: 0 });
      a.parties++; a.units += l.qty; a.revenueCents += l.totalCents; a.costCents += (l.costCents || 0) * l.qty;
    }
    const addOnList = Object.values(addOns).map((a) => ({ ...a, attachRate: live.length ? a.parties / live.length : 0 })).sort((x, y) => y.revenueCents - x.revenueCents);
    const addOnRevenue = sum(addOnList, (a) => a.revenueCents);
    const withAddOns = live.filter((b) => b.quote.lines.some((l) => l.kind === 'addon')).length;

    // When parties happen: weekday × start time, and how much of the open time is used
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const grid = {};
    for (const b of live) {
      const dow = new Date(`${b.party_date}T12:00:00Z`).getUTCDay();
      const k = `${dow}|${b.start_min}`;
      grid[k] = (grid[k] || 0) + 1;
    }
    const starts = [...new Set(live.map((b) => b.start_min))].sort((a, b) => a - b);
    const loc = svc.location(locationId);
    const lc = svc.locCfg(loc.id);
    const partyDays = Object.entries(lc.partyHours).filter(([, h]) => h).map(([d]) => Number(d));
    const utilization = partyDays.map((dow) => {
      const h = lc.partyHours[dow];
      const openMin = scheduling.toMinutes(h.close) - scheduling.toMinutes(h.open);
      let days = 0;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (new Date(`${d}T12:00:00Z`).getUTCDay() !== dow) continue;
        const closed = db.prepare('SELECT 1 FROM blocks WHERE block_date = ? AND location_id = ? AND start_min <= 0 AND end_min >= 1440').get(d, loc.id);
        if (!closed) days++;
      }
      const used = sum(live.filter((b) => b.location_id === loc.id && new Date(`${b.party_date}T12:00:00Z`).getUTCDay() === dow), (b) => b.endMin - b.start_min);
      const capacity = days * openMin * lc.party.maxConcurrentParties;
      return { dow, day: dayNames[dow], openDays: days, parties: live.filter((b) => b.location_id === loc.id && new Date(`${b.party_date}T12:00:00Z`).getUTCDay() === dow).length, rate: capacity ? used / capacity : 0 };
    });
    const heat = { days: partyDays.map((d) => dayNames[d]), starts: starts.map((s) => ({ start: s, label: scheduling.label12(s) })),
      cells: partyDays.map((d) => starts.map((s) => grid[`${d}|${s}`] || 0)) };

    // Where bookings come from
    const srcKey = (b) => (b.referred_by && b.source === 'web' ? 'referral' : b.source || 'web');
    const sources = {};
    for (const b of live) { const s = (sources[srcKey(b)] ||= { id: srcKey(b), name: SOURCE_NAMES[srcKey(b)] || srcKey(b), parties: 0, revenueCents: 0 }); s.parties++; s.revenueCents += b.total_cents; }

    // Holds that turned into paid parties
    const created = all.length;
    const paid = live.length + all.filter((b) => b.status === 'cancelled' && b.paid_cents > 0).length;
    const abandoned = all.filter((b) => b.status === 'expired').length;

    // Programs that win bookings back
    const n = (sql, ...a) => db.prepare(sql).get(...a).n;
    const upgrades = live.filter((b) => b.upgraded_from);
    const upgradeExtra = sum(upgrades, (b) => {
      const was = cfg.packages.find((p) => p.id === b.upgraded_from), now = cfg.packages.find((p) => p.id === b.package_id);
      return was && now ? now.priceCents - was.priceCents : 0;
    });
    const chats = db.prepare(`SELECT bookings_json FROM chat_sessions WHERE substr(created_at,1,10) BETWEEN ? AND ?`).all(addDays(from, -180), to);
    const programs = {
      chat: { conversations: chats.length, withBooking: chats.filter((c) => JSON.parse(c.bookings_json).length).length, parties: live.filter((b) => b.source === 'chat').length },
      upgrades: { parties: upgrades.length, extraCents: upgradeExtra },
      recovery: { emails: n(`SELECT COUNT(*) n FROM emails WHERE kind = 'hold_recovery'`), parties: live.filter((b) => b.source === 'recovery').length },
      waitlist: { joined: n('SELECT COUNT(*) n FROM waitlist'), notified: n('SELECT COUNT(*) n FROM waitlist WHERE notified_at IS NOT NULL'), parties: live.filter((b) => b.source === 'waitlist').length },
      guestOffers: { optIns: n("SELECT COUNT(*) n FROM contacts WHERE source IN ('rsvp','waiver')"), sent: n(`SELECT COUNT(*) n FROM emails WHERE kind = 'guest_offer'`), parties: live.filter((b) => b.source === 'guest-offer').length },
      referrals: { parties: live.filter((b) => b.referred_by).length },
    };

    return {
      from, to, location: loc.id, today,
      totals: { parties: live.length, revenueCents: revenue, avgCents: live.length ? Math.round(revenue / live.length) : 0, avgKids: live.length ? sum(live, (b) => b.kids) / live.length : 0,
        addOnRevenueCents: addOnRevenue, addOnShare: revenue ? addOnRevenue / revenue : 0, withAddOnsRate: live.length ? withAddOns / live.length : 0,
        upcoming: live.filter((b) => b.party_date >= today).length, cancelled: all.filter((b) => b.status === 'cancelled').length, rescheduled: all.filter((b) => b.reschedule_count > 0).length },
      byPackage, addOns: addOnList, utilization, heat,
      sources: Object.values(sources).sort((a, b) => b.parties - a.parties),
      funnel: { holds: created, paid, abandoned, rate: created ? paid / created : 0 },
      programs,
      days: daysBetween(from, to) + 1,
    };
  }

  return { report };
}

module.exports = { createInsights, SOURCE_NAMES };
