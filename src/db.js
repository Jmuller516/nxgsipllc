const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function open(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'nxgs.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS bookings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ref             TEXT NOT NULL UNIQUE,      -- customer-facing booking number
      token           TEXT NOT NULL,             -- secret for the customer's confirmation link
      status          TEXT NOT NULL,             -- pending | confirmed | paid | cancelled | expired
      party_date      TEXT NOT NULL,             -- YYYY-MM-DD
      start_min       INTEGER NOT NULL,          -- minutes after midnight
      package_id      TEXT NOT NULL,
      kids            INTEGER NOT NULL,
      child_name      TEXT,
      child_age       INTEGER,
      parent_name     TEXT NOT NULL,
      email           TEXT NOT NULL,
      phone           TEXT NOT NULL,
      notes           TEXT,
      quote_json      TEXT NOT NULL,
      total_cents     INTEGER NOT NULL,
      deposit_cents   INTEGER NOT NULL,
      paid_cents      INTEGER NOT NULL DEFAULT 0,
      balance_due_date TEXT,
      hold_expires_at TEXT,                      -- ISO time an unpaid booking stops holding its slot
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(party_date, status);

    CREATE TABLE IF NOT EXISTS payments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id      INTEGER NOT NULL REFERENCES bookings(id),
      kind            TEXT NOT NULL,             -- deposit | balance | full | refund
      method          TEXT NOT NULL,             -- stripe | card_in_person | cash | check | demo
      amount_cents    INTEGER NOT NULL,
      stripe_session_id TEXT UNIQUE,
      stripe_payment_intent TEXT,
      note            TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checkout_sessions (
      session_id      TEXT PRIMARY KEY,
      booking_id      INTEGER NOT NULL REFERENCES bookings(id),
      kind            TEXT NOT NULL,
      amount_cents    INTEGER NOT NULL,
      url             TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leads (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type      TEXT NOT NULL,
      name            TEXT NOT NULL,
      organization    TEXT,
      email           TEXT NOT NULL,
      phone           TEXT,
      preferred_date  TEXT,
      group_size      INTEGER,
      message         TEXT,
      status          TEXT NOT NULL DEFAULT 'new', -- new | contacted | quoted | booked | lost
      follow_up_date  TEXT,
      staff_notes     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Every email the app sends (or would send) — the admin "Emails" tab.
    CREATE TABLE IF NOT EXISTS emails (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key      TEXT UNIQUE,               -- e.g. balance_reminder:42 so each reminder goes once
      booking_id      INTEGER REFERENCES bookings(id),
      lead_id         INTEGER REFERENCES leads(id),
      kind            TEXT NOT NULL,
      to_addr         TEXT NOT NULL,
      subject         TEXT NOT NULL,
      html            TEXT NOT NULL,
      text            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued', -- queued | sent | failed | not_configured
      attempts        INTEGER NOT NULL DEFAULT 0,
      error           TEXT,
      provider_id     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at         TEXT
    );

    -- Days or times staff have closed (holidays, tournaments, private events).
    CREATE TABLE IF NOT EXISTS blocks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      block_date      TEXT NOT NULL,             -- YYYY-MM-DD
      start_min       INTEGER NOT NULL DEFAULT 0,
      end_min         INTEGER NOT NULL DEFAULT 1440,
      reason          TEXT,                      -- shown to staff only
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_date ON blocks(block_date);

    -- Small key/value store (QuickBooks connection tokens, etc.)
    CREATE TABLE IF NOT EXISTS settings (
      key             TEXT PRIMARY KEY,
      value           TEXT NOT NULL,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One row per payment that should be copied into QuickBooks Online.
    CREATE TABLE IF NOT EXISTS qbo_sync (
      payment_id      INTEGER PRIMARY KEY REFERENCES payments(id),
      status          TEXT NOT NULL DEFAULT 'pending', -- pending | synced | failed
      attempts        INTEGER NOT NULL DEFAULT 0,
      qbo_id          TEXT,
      error           TEXT,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

module.exports = { open };
