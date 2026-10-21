// QuickBooks Online sync: every payment the app takes (Stripe or at the desk) becomes a
// Sales Receipt in QuickBooks, under the customer and a "Party Booking" product/service.
//
// Setup (once): create an app at developer.intuit.com, add the redirect URI
// `${BASE_URL}/quickbooks/callback`, then set QBO_CLIENT_ID, QBO_CLIENT_SECRET and
// QBO_ENVIRONMENT (sandbox | production). Then press "Connect QuickBooks" on the admin page.

const crypto = require('node:crypto');
const config = require('./config');

const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const API = { production: 'https://quickbooks.api.intuit.com', sandbox: 'https://sandbox-quickbooks.api.intuit.com' };
const MINOR_VERSION = 75;
const MAX_ATTEMPTS = 8;

function createQuickBooks(db, opts = {}) {
  const cfg = opts.config || config;
  const http = opts.fetch || ((...a) => fetch(...a));
  const clock = opts.clock || (() => new Date());
  const env = () => ({
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    environment: process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    baseUrl: (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  });
  const configured = () => !!(env().clientId && env().clientSecret);
  const redirectUri = () => `${env().baseUrl}/quickbooks/callback`;

  // ---------- settings ----------
  const getSetting = (k) => {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    return r ? JSON.parse(r.value) : null;
  };
  const setSetting = (k, v) => db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(k, JSON.stringify(v));
  const delSetting = (k) => db.prepare('DELETE FROM settings WHERE key = ?').run(k);

  // ---------- OAuth ----------
  function authorizeUrl() {
    if (!configured()) throw new Error('Set QBO_CLIENT_ID and QBO_CLIENT_SECRET first.');
    const state = crypto.randomBytes(16).toString('hex');
    setSetting('qbo_oauth_state', { state, at: clock().getTime() });
    const q = new URLSearchParams({ client_id: env().clientId, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: redirectUri(), state });
    return `${AUTH_URL}?${q}`;
  }

  async function tokenRequest(form) {
    const { clientId, clientSecret } = env();
    const res = await http(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`QuickBooks sign-in failed: ${data.error_description || data.error || res.status}`);
    return data;
  }

  function saveTokens(data, realmId) {
    const now = clock().getTime();
    const prev = getSetting('qbo_tokens') || {};
    setSetting('qbo_tokens', {
      realmId: realmId || prev.realmId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      accessExpiresAt: now + (data.expires_in || 3600) * 1000,
      refreshExpiresAt: now + (data.x_refresh_token_expires_in || 8640000) * 1000,
      connectedAt: prev.connectedAt || new Date(now).toISOString(),
    });
  }

  async function handleCallback({ code, state, realmId, error }) {
    if (error) throw new Error(`QuickBooks connection was not approved (${error}).`);
    const saved = getSetting('qbo_oauth_state');
    delSetting('qbo_oauth_state');
    if (!saved || !state || saved.state !== state || clock().getTime() - saved.at > 15 * 60000) {
      throw new Error('This QuickBooks sign-in link expired. Please press Connect again.');
    }
    if (!code || !realmId) throw new Error('QuickBooks did not return a company.');
    saveTokens(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() }), realmId);
    const info = await api('GET', `/companyinfo/${realmId}`).catch(() => null);
    if (info?.CompanyInfo?.CompanyName) setSetting('qbo_company', info.CompanyInfo.CompanyName);
    return status();
  }

  async function accessToken() {
    const t = getSetting('qbo_tokens');
    if (!t) throw new Error('QuickBooks is not connected.');
    if (t.accessExpiresAt - clock().getTime() > 60000) return t;
    // QuickBooks rotates the refresh token; always store the new one.
    saveTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken }), t.realmId);
    return getSetting('qbo_tokens');
  }

  async function disconnect() {
    const t = getSetting('qbo_tokens');
    if (t && configured()) {
      const { clientId, clientSecret } = env();
      await http(REVOKE_URL, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'), Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: t.refreshToken }),
      }).catch(() => {});
    }
    delSetting('qbo_tokens');
    delSetting('qbo_company');
    delSetting('qbo_item_id');
  }

  // ---------- API ----------
  async function api(method, path, body) {
    const t = await accessToken();
    const url = `${API[env().environment]}/v3/company/${t.realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=${MINOR_VERSION}`;
    const res = await http(url, {
      method,
      headers: { Authorization: `Bearer ${t.accessToken}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const f = data?.Fault?.Error?.[0];
      throw new Error(`QuickBooks: ${f ? `${f.Message}${f.Detail ? ` — ${f.Detail}` : ''}` : res.status}`);
    }
    return data;
  }

  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function query(sql) {
    const data = await api('GET', `/query?query=${encodeURIComponent(sql)}`);
    return data.QueryResponse || {};
  }

  async function findOrCreateCustomer(b) {
    // DisplayName must be unique in QuickBooks, so include the email.
    const displayName = `${b.parent_name} - ${b.email}`.replace(/[:\t\n]/g, ' ').slice(0, 100);
    const found = (await query(`select Id from Customer where DisplayName = '${q(displayName)}'`)).Customer;
    if (found?.length) return found[0].Id;
    const [given, ...rest] = b.parent_name.split(' ');
    const created = await api('POST', '/customer', {
      DisplayName: displayName,
      GivenName: given?.slice(0, 100),
      FamilyName: rest.join(' ').slice(0, 100) || undefined,
      PrimaryEmailAddr: { Address: b.email },
      PrimaryPhone: b.phone ? { FreeFormNumber: b.phone } : undefined,
      Notes: `NXGS party app customer`,
    });
    return created.Customer.Id;
  }

  async function partyItemId() {
    const cached = getSetting('qbo_item_id');
    if (cached) return cached;
    const name = cfg.quickbooks.itemName;
    let item = (await query(`select Id from Item where Name = '${q(name)}'`)).Item?.[0];
    if (!item) {
      let account = (await query(`select Id from Account where Name = '${q(cfg.quickbooks.incomeAccountName)}'`)).Account?.[0];
      if (!account) account = (await query(`select Id from Account where AccountType = 'Income' maxresults 1`)).Account?.[0];
      if (!account) throw new Error('No income account found in QuickBooks for the party item.');
      item = (await api('POST', '/item', { Name: name, Type: 'Service', Taxable: false, IncomeAccountRef: { value: account.Id }, Description: 'Party & event bookings (NXGS party app)' })).Item;
    }
    setSetting('qbo_item_id', item.Id);
    return item.Id;
  }

  async function depositAccountId() {
    const name = cfg.quickbooks.depositToAccountName;
    if (!name) return null;
    const cached = getSetting('qbo_deposit_account');
    if (cached?.name === name) return cached.id;
    const acct = (await query(`select Id from Account where Name = '${q(name)}'`)).Account?.[0];
    if (!acct) throw new Error(`QuickBooks account "${name}" not found.`);
    setSetting('qbo_deposit_account', { name, id: acct.Id });
    return acct.Id;
  }

  /** Copy one payment into QuickBooks as a Sales Receipt. Returns the QuickBooks id. */
  async function pushPayment(paymentId) {
    const p = db.prepare(`SELECT p.*, b.ref, b.parent_name, b.email, b.phone, b.party_date, b.start_min, b.package_id, b.kids, b.child_name, b.quote_json, b.total_cents
      FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = ?`).get(paymentId);
    if (!p) throw new Error('Payment not found');
    const quote = JSON.parse(p.quote_json);
    const docNumber = `${p.ref}-${p.id}`.slice(0, 21);

    // Already there (e.g. a previous attempt timed out after QuickBooks saved it)?
    const existing = (await query(`select Id from SalesReceipt where DocNumber = '${q(docNumber)}'`)).SalesReceipt?.[0];
    if (existing) return existing.Id;

    const taxShare = p.total_cents ? Math.round((p.amount_cents * quote.taxCents) / p.total_cents) : 0;
    const kindLabel = { deposit: 'Deposit', balance: 'Balance payment', full: 'Payment in full' }[p.kind] || p.kind;
    const desc = `${kindLabel} — ${quote.packageName}, ${p.kids} kids, party ${p.party_date}${p.child_name ? ` (${p.child_name})` : ''}. Booking ${p.ref}. Includes ${(taxShare / 100).toFixed(2)} sales tax.`;
    const [customerId, itemId, depositId] = [await findOrCreateCustomer(p), await partyItemId(), await depositAccountId()];
    const amount = Number((p.amount_cents / 100).toFixed(2));

    const receipt = {
      DocNumber: docNumber,
      TxnDate: p.created_at.slice(0, 10),
      CustomerRef: { value: customerId },
      PrivateNote: `NXGS party app · ${p.ref} · ${p.kind} · ${p.method.replace(/_/g, ' ')}${p.stripe_payment_intent ? ` · Stripe ${p.stripe_payment_intent}` : ''}${p.note ? ` · ${p.note}` : ''}`.slice(0, 4000),
      PaymentRefNum: (p.stripe_payment_intent || p.ref).slice(-21),
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: amount,
        Description: desc.slice(0, 4000),
        SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount, TaxCodeRef: { value: 'NON' } },
      }],
      ...(depositId ? { DepositToAccountRef: { value: depositId } } : {}),
    };
    const res = await api('POST', '/salesreceipt', receipt);
    return res.SalesReceipt.Id;
  }

  // ---------- queue ----------
  function onPayment(_booking, payment) {
    if (payment.method === 'demo') return; // never send demo payments to the books
    db.prepare(`INSERT OR IGNORE INTO qbo_sync (payment_id) VALUES (?)`).run(payment.id);
  }

  function connected() {
    return !!getSetting('qbo_tokens');
  }

  /** Send every pending payment to QuickBooks. Safe to run on a timer. */
  async function syncPending() {
    if (!configured() || !connected()) return { synced: 0, failed: 0, skipped: true };
    const rows = db.prepare(`SELECT payment_id FROM qbo_sync WHERE status IN ('pending','failed') AND attempts < ? ORDER BY payment_id LIMIT 25`).all(MAX_ATTEMPTS);
    let synced = 0, failed = 0;
    for (const { payment_id } of rows) {
      try {
        const id = await pushPayment(payment_id);
        db.prepare(`UPDATE qbo_sync SET status = 'synced', qbo_id = ?, error = NULL, attempts = attempts + 1, updated_at = datetime('now') WHERE payment_id = ?`).run(String(id), payment_id);
        synced++;
      } catch (e) {
        db.prepare(`UPDATE qbo_sync SET status = 'failed', error = ?, attempts = attempts + 1, updated_at = datetime('now') WHERE payment_id = ?`).run(String(e.message).slice(0, 500), payment_id);
        failed++;
        if (/not connected|sign-in failed/i.test(e.message)) break; // no point hammering
      }
    }
    return { synced, failed };
  }

  function retry(paymentId) {
    db.prepare(`UPDATE qbo_sync SET status = 'pending', attempts = 0, error = NULL WHERE payment_id = ?`).run(paymentId);
  }

  function status() {
    const t = getSetting('qbo_tokens');
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM qbo_sync GROUP BY status').all().map((r) => [r.status, r.n]));
    const failures = db.prepare(`SELECT s.payment_id, s.error, s.attempts, p.amount_cents, b.ref FROM qbo_sync s
      JOIN payments p ON p.id = s.payment_id JOIN bookings b ON b.id = p.booking_id WHERE s.status = 'failed' ORDER BY s.payment_id DESC LIMIT 20`).all();
    return {
      configured: configured(),
      environment: env().environment,
      redirectUri: redirectUri(),
      connected: !!t,
      company: getSetting('qbo_company'),
      connectedAt: t?.connectedAt || null,
      reconnectBy: t ? new Date(t.refreshExpiresAt).toISOString().slice(0, 10) : null,
      pending: counts.pending || 0,
      synced: counts.synced || 0,
      failed: counts.failed || 0,
      failures,
    };
  }

  return { authorizeUrl, handleCallback, disconnect, onPayment, syncPending, pushPayment, retry, status, connected, configured };
}

module.exports = { createQuickBooks };
