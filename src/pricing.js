const config = require('./config');

class PricingError extends Error {}

/**
 * Build a full quote for a party.
 * @param {object} input { packageId, kids, addOns: { [id]: qty }, partyDate: 'YYYY-MM-DD', today: 'YYYY-MM-DD' }
 */
function quote(input, cfg = config) {
  const pkg = cfg.packages.find((p) => p.id === input.packageId);
  if (!pkg || pkg.active === false) throw new PricingError('Please choose a party package.');

  const kids = Number(input.kids);
  if (!Number.isInteger(kids) || kids < 1) throw new PricingError('Number of kids must be at least 1.');
  if (kids > cfg.party.maxKids) throw new PricingError(`Parties are limited to ${cfg.party.maxKids} kids.`);

  const lines = [];
  lines.push({ id: pkg.id, name: pkg.name, qty: 1, unitCents: pkg.priceCents, taxable: pkg.taxable, kind: 'package' });

  const extraKids = Math.max(0, kids - pkg.includedKids);
  if (extraKids > 0) {
    lines.push({ id: 'extra-kids', name: `Extra child (over ${pkg.includedKids})`, qty: extraKids, unitCents: pkg.extraKidCents, taxable: pkg.taxable, kind: 'extra' });
  }

  const daysUntilParty = daysBetween(input.today, input.partyDate);
  for (const [id, rawQty] of Object.entries(input.addOns || {})) {
    const qty = Number(rawQty);
    if (!qty) continue;
    const addOn = cfg.addOns.find((a) => a.id === id);
    if (!addOn) throw new PricingError(`Unknown add-on: ${id}`);
    if (addOn.active === false) throw new PricingError(`${addOn.name} is no longer offered.`);
    if (!Number.isInteger(qty) || qty < 0 || qty > 200) throw new PricingError(`Invalid quantity for ${addOn.name}.`);
    if (addOn.minQty && qty < addOn.minQty) throw new PricingError(`${addOn.name}: minimum order is ${addOn.minQty}.`);
    if (addOn.maxQty && qty > addOn.maxQty) throw new PricingError(`${addOn.name}: limit ${addOn.maxQty} per party.`);
    if (addOn.leadDays && daysUntilParty < addOn.leadDays) {
      throw new PricingError(`${addOn.name} needs ${addOn.leadDays} days to make — not available for this party date.`);
    }
    lines.push({ id: addOn.id, name: addOn.name, qty, unitCents: addOn.priceCents, taxable: addOn.taxable, kind: 'addon', vendor: addOn.vendor, costCents: addOn.costCents });
  }

  for (const l of lines) l.totalCents = l.unitCents * l.qty;

  const subtotalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  const taxableCents = lines.filter((l) => l.taxable).reduce((s, l) => s + l.totalCents, 0);
  const taxCents = Math.round(taxableCents * cfg.tax.rate);
  const totalCents = subtotalCents + taxCents;

  const daysOut = daysBetween(input.today, input.partyDate);
  const payInFull = daysOut < cfg.payments.balanceDueDaysBefore;
  const depositCents = payInFull ? totalCents : Math.round((totalCents * cfg.payments.depositPercent) / 100);
  const balanceCents = totalCents - depositCents;
  const balanceDueDate = payInFull ? null : addDays(input.partyDate, -cfg.payments.balanceDueDaysBefore);

  return { packageId: pkg.id, packageName: pkg.name, kids, lines, subtotalCents, taxCents, totalCents, depositCents, balanceCents, balanceDueDate, payInFull };
}

function daysBetween(fromYmd, toYmd) {
  const a = Date.UTC(...ymd(fromYmd));
  const b = Date.UTC(...ymd(toYmd));
  return Math.round((b - a) / 86400000);
}

function addDays(dateYmd, n) {
  const [y, m, d] = ymd(dateYmd);
  const dt = new Date(Date.UTC(y, m, d + n));
  return dt.toISOString().slice(0, 10);
}

function ymd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw new PricingError('Invalid date.');
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

module.exports = { quote, daysBetween, addDays, money, PricingError };
