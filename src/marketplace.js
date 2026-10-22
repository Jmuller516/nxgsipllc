// Outside vendors selling through NXGS. Vendors apply with their own (wholesale) price; NXGS adds
// its markup and the product appears as a party add-on under "From our partners". When a family
// pays, the vendor gets an order and the app tracks what NXGS owes the vendor.
const config = require('./config');
const { BookingError } = require('./bookings');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const AUDIENCES = ['birthday', 'corporate', 'both'];
const ORDER_STATUSES = ['new', 'confirmed', 'delivered', 'paid_out', 'cancelled'];

function createMarketplace(db, opts = {}) {
  const cfg = opts.config || config;
  const hooks = opts.hooks || {};
  const fire = (name, ...args) => { for (const h of [].concat(hooks[name] || [])) { try { h(...args); } catch (e) { console.error(`${name} hook failed:`, e); } } };

  const vendorRow = (v) => v && ({ ...v, audiences: JSON.parse(v.audiences || '[]'), insured: !!v.insured });

  function markupFor(p, v) {
    return p.markup_percent ?? v.markup_percent ?? cfg.marketplace.defaultMarkupPercent;
  }
  /** Customer price: the vendor's price plus NXGS's markup (unless a price was set by hand). */
  function priceFor(p, v) {
    if (p.price_cents != null) return p.price_cents;
    return Math.round(p.cost_cents * (1 + markupFor(p, v) / 100));
  }

  function productView(p, v) {
    const price = priceFor(p, v);
    return { ...p, active: !!p.active, markupApplied: markupFor(p, v), priceApplied: price, marginCents: price - p.cost_cents, vendorName: v.business_name };
  }

  // ---------- catalog: merge live partner products into the add-on list ----------
  function apply(target = cfg) {
    for (let i = target.addOns.length - 1; i >= 0; i--) if (target.addOns[i].marketplace) target.addOns.splice(i, 1);
    const rows = db.prepare(`SELECT p.*, v.business_name, v.markup_percent AS v_markup FROM vendor_products p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.active = 1 AND v.status = 'approved' AND p.audience IN ('birthday','both') ORDER BY v.business_name, p.name`).all();
    for (const r of rows) {
      const v = { markup_percent: r.v_markup };
      target.addOns.push({
        id: `mp-${r.id}`, category: 'partners', name: r.name, detail: [r.detail, `by ${r.business_name}`].filter(Boolean).join(' · '),
        unit: r.unit || 'each', priceCents: priceFor(r, v), costCents: r.cost_cents, minQty: r.min_qty || 1, maxQty: r.max_qty || undefined,
        leadDays: r.lead_days || 0, vendor: r.business_name, vendorId: r.vendor_id, taxable: true, includes: r.includes || '',
        photo: r.photo || '', active: true, marketplace: true, productId: r.id,
      });
    }
    return rows.length;
  }

  // ---------- applications ----------
  function applyAsVendor(input) {
    const business = clean(input.businessName, 120), contact = clean(input.contactName, 120);
    const email = clean(input.email, 200)?.toLowerCase();
    if (!business || !contact) throw new BookingError('Please enter your business name and your name.');
    if (!email || !EMAIL.test(email)) throw new BookingError('Please enter a valid email.');
    const audiences = (Array.isArray(input.audiences) ? input.audiences : []).filter((a) => ['birthday', 'corporate'].includes(a));
    if (!audiences.length) throw new BookingError('Choose birthday parties, corporate events, or both.');
    const products = (Array.isArray(input.products) ? input.products : []).filter((p) => clean(p?.name)).slice(0, 10);
    if (!products.length) throw new BookingError('Add at least one product you’d like to offer.');
    const prepared = products.map((p, i) => {
      const cost = Math.round(Number(p.price) * 100);
      if (!Number.isFinite(cost) || cost <= 0) throw new BookingError(`Product ${i + 1}: enter your price.`);
      return {
        name: clean(p.name, 120), detail: clean(p.description, 300), unit: clean(p.unit, 20) || 'each', cost,
        min: Math.max(1, Math.round(Number(p.minQty) || 1)), lead: Math.max(0, Math.round(Number(p.leadDays) || 7)),
        audience: audiences.length === 2 ? 'both' : audiences[0],
      };
    });
    let website = clean(input.website, 300);
    if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
    db.exec('BEGIN IMMEDIATE');
    try {
      const info = db.prepare(`INSERT INTO vendors (business_name, contact_name, email, phone, website, category, description, audiences, insured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(business, contact, email, clean(input.phone, 40), website, clean(input.category, 80),
        clean(input.description, 2000), JSON.stringify(audiences), input.insured ? 1 : 0);
      const vendorId = Number(info.lastInsertRowid);
      const stmt = db.prepare(`INSERT INTO vendor_products (vendor_id, name, detail, unit, cost_cents, min_qty, lead_days, audience, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`);
      for (const p of prepared) stmt.run(vendorId, p.name, p.detail, p.unit, p.cost, p.min, p.lead, p.audience);
      db.exec('COMMIT');
      const v = getVendor(vendorId);
      fire('onVendorApplied', v);
      return { ok: true, id: vendorId };
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- admin: vendors & products ----------
  function listVendors() {
    return db.prepare(`SELECT v.*,
        (SELECT COUNT(*) FROM vendor_products p WHERE p.vendor_id = v.id) AS product_count,
        (SELECT COUNT(*) FROM vendor_products p WHERE p.vendor_id = v.id AND p.active = 1) AS live_count,
        (SELECT COALESCE(SUM(o.unit_cost_cents * o.qty), 0) FROM vendor_orders o WHERE o.vendor_id = v.id AND o.status IN ('new','confirmed','delivered')) AS owed_cents
      FROM vendors v ORDER BY CASE v.status WHEN 'applied' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, v.created_at DESC`).all().map(vendorRow);
  }

  function getVendor(id) {
    const v = vendorRow(db.prepare('SELECT * FROM vendors WHERE id = ?').get(id));
    if (!v) return null;
    v.products = db.prepare('SELECT * FROM vendor_products WHERE vendor_id = ? ORDER BY id').all(id).map((p) => productView(p, v));
    return v;
  }

  function updateVendor(id, input) {
    const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(id);
    if (!v) throw new BookingError('Vendor not found.');
    const status = input.status ?? v.status;
    if (!['applied', 'approved', 'rejected', 'paused'].includes(status)) throw new BookingError('Invalid status.');
    let markup = v.markup_percent;
    if (input.markupPercent !== undefined) {
      markup = input.markupPercent === '' || input.markupPercent === null ? null : Number(input.markupPercent);
      if (markup !== null && (!Number.isFinite(markup) || markup < 0 || markup > 500)) throw new BookingError('Markup must be 0–500%.');
    }
    db.prepare(`UPDATE vendors SET status = ?, markup_percent = ?, notes = ?, insured = ?, approved_at = CASE WHEN ? = 'approved' AND approved_at IS NULL THEN datetime('now') ELSE approved_at END WHERE id = ?`)
      .run(status, markup, input.notes !== undefined ? clean(input.notes, 2000) : v.notes, input.insured !== undefined ? (input.insured ? 1 : 0) : v.insured, status, id);
    apply();
    return getVendor(id);
  }

  function saveProduct(vendorId, productId, input) {
    const v = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId);
    if (!v) throw new BookingError('Vendor not found.');
    const existing = productId ? db.prepare('SELECT * FROM vendor_products WHERE id = ? AND vendor_id = ?').get(productId, vendorId) : null;
    if (productId && !existing) throw new BookingError('Product not found.');
    const e = existing || {};
    const name = clean(input.name ?? e.name, 120);
    if (!name) throw new BookingError('Enter a product name.');
    const money = (val, fallback) => (val === undefined ? fallback : (val === '' || val === null ? null : Math.round(Number(val) * 100)));
    const cost = money(input.cost, e.cost_cents);
    if (!Number.isFinite(cost) || cost <= 0) throw new BookingError('Enter the vendor’s price.');
    const price = money(input.price, e.price_cents ?? null);
    if (price !== null && (!Number.isFinite(price) || price <= 0)) throw new BookingError('Price must be more than $0.');
    let markup = input.markupPercent === undefined ? e.markup_percent ?? null : (input.markupPercent === '' || input.markupPercent === null ? null : Number(input.markupPercent));
    if (markup !== null && (!Number.isFinite(markup) || markup < 0 || markup > 500)) throw new BookingError('Markup must be 0–500%.');
    const audience = input.audience ?? e.audience ?? 'birthday';
    if (!AUDIENCES.includes(audience)) throw new BookingError('Invalid audience.');
    const int = (val, fallback, min) => (val === undefined ? fallback : Math.max(min, Math.round(Number(val) || 0)));
    const fields = {
      name, detail: input.detail !== undefined ? clean(input.detail, 300) : e.detail ?? null,
      includes: input.includes !== undefined ? clean(input.includes, 1500) : e.includes ?? null,
      unit: clean(input.unit ?? e.unit, 20) || 'each', cost_cents: cost, markup_percent: markup, price_cents: price,
      min_qty: int(input.minQty, e.min_qty ?? 1, 1), max_qty: input.maxQty === undefined ? e.max_qty ?? null : (input.maxQty ? Math.max(1, Math.round(Number(input.maxQty))) : null),
      lead_days: int(input.leadDays, e.lead_days ?? 7, 0), audience,
      active: input.active === undefined ? (e.active ?? 0) : (input.active ? 1 : 0),
    };
    if (existing) {
      db.prepare(`UPDATE vendor_products SET ${Object.keys(fields).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(fields), productId);
    } else {
      const cols = Object.keys(fields);
      db.prepare(`INSERT INTO vendor_products (vendor_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(vendorId, ...Object.values(fields));
    }
    apply();
    return getVendor(vendorId);
  }

  function setProductPhoto(productId, path) {
    const p = db.prepare('SELECT photo, vendor_id FROM vendor_products WHERE id = ?').get(productId);
    if (!p) throw new BookingError('Product not found.');
    db.prepare('UPDATE vendor_products SET photo = ? WHERE id = ?').run(path, productId);
    apply();
    return p.photo;
  }

  /** Partner products for corporate events (shown on the group & corporate request form). */
  function corporateCatalog() {
    return db.prepare(`SELECT p.*, v.business_name, v.markup_percent AS v_markup FROM vendor_products p JOIN vendors v ON v.id = p.vendor_id
      WHERE p.active = 1 AND v.status = 'approved' AND p.audience IN ('corporate','both') ORDER BY p.name`).all()
      .map((r) => ({ id: r.id, name: r.name, detail: r.detail, vendor: r.business_name, unit: r.unit, priceCents: priceFor(r, { markup_percent: r.v_markup }), photo: r.photo || '' }));
  }

  // ---------- orders ----------
  /** When a family pays, partner items on their party become orders for each vendor (once). */
  function onPayment(booking) {
    const lines = booking.quote.lines.filter((l) => /^mp-\d+$/.test(l.id));
    if (!lines.length || booking.status === 'cancelled') return;
    const created = [];
    for (const l of lines) {
      const productId = Number(l.id.slice(3));
      const p = db.prepare('SELECT * FROM vendor_products WHERE id = ?').get(productId);
      if (!p) continue;
      const info = db.prepare(`INSERT OR IGNORE INTO vendor_orders (booking_id, vendor_id, product_id, product_name, qty, unit_cost_cents, unit_price_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(booking.id, p.vendor_id, productId, l.name, l.qty, l.costCents ?? p.cost_cents, l.unitCents);
      if (info.changes) created.push(Number(info.lastInsertRowid));
    }
    if (!created.length) return;
    const byVendor = {};
    for (const id of created) {
      const o = db.prepare('SELECT * FROM vendor_orders WHERE id = ?').get(id);
      (byVendor[o.vendor_id] ||= []).push(o);
    }
    for (const [vendorId, orders] of Object.entries(byVendor)) fire('onVendorOrder', getVendor(Number(vendorId)), orders, booking);
  }

  function onCancel(bookingId) {
    db.prepare(`UPDATE vendor_orders SET status = 'cancelled' WHERE booking_id = ? AND status IN ('new','confirmed')`).run(bookingId);
  }

  function listOrders() {
    return db.prepare(`SELECT o.*, v.business_name, b.ref, b.party_date, b.start_min, b.child_name, b.location_id, b.status AS booking_status
      FROM vendor_orders o JOIN vendors v ON v.id = o.vendor_id JOIN bookings b ON b.id = o.booking_id ORDER BY b.party_date, o.id`).all();
  }

  function setOrderStatus(id, status) {
    if (!ORDER_STATUSES.includes(status)) throw new BookingError('Invalid order status.');
    db.prepare(`UPDATE vendor_orders SET status = ?, paid_out_at = CASE WHEN ? = 'paid_out' THEN datetime('now') ELSE paid_out_at END WHERE id = ?`).run(status, status, id);
  }

  function totals() {
    const r = db.prepare(`SELECT COALESCE(SUM(unit_price_cents * qty), 0) revenue, COALESCE(SUM(unit_cost_cents * qty), 0) cost FROM vendor_orders WHERE status != 'cancelled'`).get();
    const owed = db.prepare(`SELECT COALESCE(SUM(unit_cost_cents * qty), 0) n FROM vendor_orders WHERE status IN ('new','confirmed','delivered')`).get().n;
    return { revenueCents: r.revenue, costCents: r.cost, marginCents: r.revenue - r.cost, owedCents: owed, applications: db.prepare(`SELECT COUNT(*) n FROM vendors WHERE status = 'applied'`).get().n };
  }

  return { apply, applyAsVendor, listVendors, getVendor, updateVendor, saveProduct, setProductPhoto, corporateCatalog, onPayment, onCancel, listOrders, setOrderStatus, totals, priceFor };
}

module.exports = { createMarketplace };
