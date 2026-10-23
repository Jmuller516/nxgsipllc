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

    -- Uploaded images (e.g. product photos for add-ons).
    CREATE TABLE IF NOT EXISTS media (
      id              TEXT PRIMARY KEY,
      content_type    TEXT NOT NULL,
      bytes           BLOB NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

    -- Guests' replies to a party invitation.
    CREATE TABLE IF NOT EXISTS rsvps (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id      INTEGER NOT NULL REFERENCES bookings(id),
      token           TEXT NOT NULL UNIQUE,      -- lets the guest edit their reply
      child_name      TEXT NOT NULL,
      parent_name     TEXT NOT NULL,
      email           TEXT,
      phone           TEXT,
      attending       TEXT NOT NULL,             -- yes | no
      allergies       TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rsvps_booking ON rsvps(booking_id);

    -- Signed liability waivers (one per child per guardian, valid for a set time).
    CREATE TABLE IF NOT EXISTS waivers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      waiver_version  TEXT NOT NULL,             -- fingerprint of the waiver text that was signed
      booking_id      INTEGER REFERENCES bookings(id),
      child_name      TEXT NOT NULL,
      child_birthdate TEXT,
      guardian_name   TEXT NOT NULL,
      guardian_email  TEXT NOT NULL,
      guardian_phone  TEXT,
      emergency_name  TEXT,
      emergency_phone TEXT,
      medical_notes   TEXT,
      typed_signature TEXT NOT NULL,
      signature_media TEXT,                      -- drawn signature image (media id)
      ip              TEXT,
      user_agent      TEXT,
      signed_at       TEXT NOT NULL,
      expires_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_waivers_lookup ON waivers(guardian_email, child_name);

    -- Gift cards and referral credits (credits are gift cards with kind = 'referral').
    CREATE TABLE IF NOT EXISTS gift_cards (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      code            TEXT NOT NULL UNIQUE,
      kind            TEXT NOT NULL,             -- purchase | referral | manual
      status          TEXT NOT NULL,             -- pending | active | void
      initial_cents   INTEGER NOT NULL,
      buyer_name      TEXT,
      buyer_email     TEXT,
      recipient_name  TEXT,
      recipient_email TEXT,
      message         TEXT,
      source_booking_id INTEGER,                 -- referral credits: the booking that earned it
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      activated_at    TEXT
    );
    -- Money taken off a gift card. 'held' while a booking waits for its card payment.
    CREATE TABLE IF NOT EXISTS gift_card_uses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      gift_card_id    INTEGER NOT NULL REFERENCES gift_cards(id),
      booking_id      INTEGER NOT NULL REFERENCES bookings(id),
      amount_cents    INTEGER NOT NULL,
      status          TEXT NOT NULL,             -- held | used | released
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS gift_sessions (
      session_id      TEXT PRIMARY KEY,
      gift_card_id    INTEGER NOT NULL REFERENCES gift_cards(id),
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Reviews parents leave after their party.
    CREATE TABLE IF NOT EXISTS reviews (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id      INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
      rating          INTEGER NOT NULL,
      comment         TEXT,
      display_name    TEXT,
      may_publish     INTEGER NOT NULL DEFAULT 0,  -- the parent agreed it can be shown
      approved        INTEGER NOT NULL DEFAULT 0,  -- staff approved it for the website
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    -- Sponsors and where their logo appears.
    CREATE TABLE IF NOT EXISTS sponsors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      website         TEXT,
      logo            TEXT,                      -- media path
      tagline         TEXT,
      package_id      TEXT,
      placements      TEXT NOT NULL DEFAULT '[]', -- JSON array
      location_id     TEXT,                      -- null = all locations
      starts_on       TEXT,
      ends_on         TEXT,
      contract_cents  INTEGER NOT NULL DEFAULT 0,
      billing         TEXT,                      -- e.g. monthly, one-time
      status          TEXT NOT NULL DEFAULT 'active', -- active | paused | ended
      contact_name    TEXT,
      contact_email   TEXT,
      contact_phone   TEXT,
      notes           TEXT,
      impressions     INTEGER NOT NULL DEFAULT 0,
      clicks          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Outside vendors who sell products through NXGS.
    CREATE TABLE IF NOT EXISTS vendors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name   TEXT NOT NULL,
      contact_name    TEXT NOT NULL,
      email           TEXT NOT NULL,
      phone           TEXT,
      website         TEXT,
      category        TEXT,
      description     TEXT,
      audiences       TEXT NOT NULL DEFAULT '["birthday"]', -- birthday, corporate
      status          TEXT NOT NULL DEFAULT 'applied',    -- applied | approved | rejected | paused
      markup_percent  REAL,                                -- null = marketplace default
      insured         INTEGER NOT NULL DEFAULT 0,          -- vendor says they carry liability insurance
      notes           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at     TEXT
    );
    CREATE TABLE IF NOT EXISTS vendor_products (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id       INTEGER NOT NULL REFERENCES vendors(id),
      name            TEXT NOT NULL,
      detail          TEXT,
      includes        TEXT,
      unit            TEXT NOT NULL DEFAULT 'each',
      cost_cents      INTEGER NOT NULL,          -- what NXGS pays the vendor
      markup_percent  REAL,                      -- null = vendor/marketplace default
      price_cents     INTEGER,                   -- set to override the calculated price
      min_qty         INTEGER NOT NULL DEFAULT 1,
      max_qty         INTEGER,
      lead_days       INTEGER NOT NULL DEFAULT 7,
      audience        TEXT NOT NULL DEFAULT 'birthday', -- birthday | corporate | both
      photo           TEXT,
      active          INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS vendor_orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id      INTEGER NOT NULL REFERENCES bookings(id),
      vendor_id       INTEGER NOT NULL REFERENCES vendors(id),
      product_id      INTEGER NOT NULL REFERENCES vendor_products(id),
      product_name    TEXT NOT NULL,
      qty             INTEGER NOT NULL,
      unit_cost_cents INTEGER NOT NULL,
      unit_price_cents INTEGER NOT NULL,
      status          TEXT NOT NULL DEFAULT 'new', -- new | confirmed | delivered | paid_out | cancelled
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      paid_out_at     TEXT,
      UNIQUE (booking_id, product_id)
    );
  `);

  db.exec(`
    -- Families waiting for a full day to open up.
    CREATE TABLE IF NOT EXISTS waitlist (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id     TEXT NOT NULL,
      party_date      TEXT NOT NULL,
      package_id      TEXT,
      kids            INTEGER,
      parent_name     TEXT NOT NULL,
      email           TEXT NOT NULL,
      phone           TEXT,
      sms_opt_in      INTEGER NOT NULL DEFAULT 0,
      lang            TEXT NOT NULL DEFAULT 'en',
      status          TEXT NOT NULL DEFAULT 'waiting', -- waiting | notified | booked | removed
      notified_at     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_date ON waitlist(location_id, party_date, status);

    -- Families who said yes to hearing about camps, clinics and party offers.
    CREATE TABLE IF NOT EXISTS contacts (
      email           TEXT PRIMARY KEY,
      name            TEXT,
      child_name      TEXT,
      phone           TEXT,
      source          TEXT NOT NULL,             -- rsvp | waiver | booking
      booking_id      INTEGER,                   -- the party they came to (guests) or booked (parents)
      lang            TEXT NOT NULL DEFAULT 'en',
      opted_in_at     TEXT NOT NULL,
      unsubscribed_at TEXT,
      last_offer_at   TEXT
    );

    -- Guests checked in at the door.
    CREATE TABLE IF NOT EXISTS checkins (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id      INTEGER NOT NULL REFERENCES bookings(id),
      child_key       TEXT NOT NULL,             -- lower-cased child name
      child_name      TEXT NOT NULL,
      how             TEXT NOT NULL,             -- tap | qr
      checked_in_at   TEXT NOT NULL,
      UNIQUE (booking_id, child_key)
    );
  `);

  // Upgrades for databases created by earlier versions.
  addColumn(db, 'bookings', 'source', "TEXT NOT NULL DEFAULT 'web'");
  addColumn(db, 'bookings', 'lang', "TEXT NOT NULL DEFAULT 'en'");
  addColumn(db, 'bookings', 'upgraded_from', 'TEXT');
  addColumn(db, 'bookings', 'video_url', 'TEXT');
  addColumn(db, 'bookings', 'reschedule_count', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'bookings', 'refund_due_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'rsvps', 'marketing_opt_in', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'waivers', 'marketing_opt_in', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'bookings', 'theme', 'TEXT');
  addColumn(db, 'bookings', 'host_name', 'TEXT');
  addColumn(db, 'bookings', 'access_code', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_access_code ON bookings(access_code) WHERE access_code IS NOT NULL');
  addColumn(db, 'bookings', 'invite_token', 'TEXT');
  addColumn(db, 'bookings', 'details_json', 'TEXT');
  addColumn(db, 'bookings', 'sms_opt_in', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'bookings', 'referral_code', 'TEXT');
  addColumn(db, 'bookings', 'referred_by', 'INTEGER');
  addColumn(db, 'emails', 'channel', "TEXT NOT NULL DEFAULT 'email'");
  addColumn(db, 'bookings', 'location_id', "TEXT NOT NULL DEFAULT 'farmingdale'");
  addColumn(db, 'leads', 'vendor_count', 'INTEGER');
  addColumn(db, 'leads', 'end_date', 'TEXT');
  addColumn(db, 'blocks', 'location_id', "TEXT NOT NULL DEFAULT 'farmingdale'");
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_invite ON bookings(invite_token)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_referral ON bookings(referral_code)');
  return db;
}

function addColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

module.exports = { open };
