// Minimal Stripe client using Stripe's REST API directly (no npm package needed).
const crypto = require('node:crypto');

const API = 'https://api.stripe.com/v1';

function enabled() {
  return !!process.env.STRIPE_SECRET_KEY;
}

// Stripe expects form encoding with bracketed nested keys: line_items[0][price_data][currency]=usd
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.join('&');
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? encode(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}

/** Create a hosted Stripe Checkout page for one payment. Stripe emails the receipt. */
function createCheckout({ amountCents, currency, productName, description, email, bookingRef, kind, successUrl, cancelUrl, expiresInMinutes }) {
  return call('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: email,
    client_reference_id: bookingRef,
    success_url: successUrl,
    cancel_url: cancelUrl,
    expires_at: expiresInMinutes ? Math.floor(Date.now() / 1000) + Math.max(30, expiresInMinutes) * 60 : undefined,
    payment_intent_data: { receipt_email: email, description, metadata: { booking_ref: bookingRef, kind } },
    metadata: { booking_ref: bookingRef, kind },
    line_items: {
      0: {
        quantity: 1,
        price_data: { currency, unit_amount: amountCents, product_data: { name: productName, description } },
      },
    },
  });
}

function getCheckout(sessionId) {
  return call('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/** Verify a webhook came from Stripe (Stripe-Signature header, HMAC-SHA256). */
function verifyWebhook(rawBody, header, secret = process.env.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=')));
  const ts = Number(parts.t);
  const sigs = String(header || '').split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!ts || !sigs.length) throw new Error('Bad signature header');
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSec) throw new Error('Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('Signature mismatch');
  return JSON.parse(rawBody);
}

module.exports = { enabled, encode, createCheckout, getCheckout, verifyWebhook };
