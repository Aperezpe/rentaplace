CREATE TABLE users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('guest','host'))
);
CREATE TABLE regions (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, region TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL
);
CREATE TABLE listings (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, description TEXT NOT NULL, neighbourhood TEXT NOT NULL, region TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL, sleeps INTEGER NOT NULL CHECK(sleeps BETWEEN 1 AND 20),
  bedrooms INTEGER NOT NULL CHECK(bedrooms BETWEEN 0 AND 15), beds INTEGER NOT NULL, bathrooms INTEGER NOT NULL,
  nightly_cents INTEGER NOT NULL CHECK(nightly_cents > 0), weekend_cents INTEGER NOT NULL CHECK(weekend_cents > 0),
  cleaning_cents INTEGER NOT NULL CHECK(cleaning_cents >= 0),
  cancellation_policy TEXT NOT NULL CHECK(cancellation_policy IN ('flexible','moderate','strict')),
  status TEXT NOT NULL CHECK(status IN ('active','paused','closed')),
  instant_book INTEGER NOT NULL CHECK(instant_book IN (0,1)),
  amenities TEXT NOT NULL, photos TEXT NOT NULL, rating REAL NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, listing_id TEXT NOT NULL REFERENCES listings(id),
  guest_id TEXT NOT NULL REFERENCES users(id), from_date TEXT NOT NULL, to_date TEXT NOT NULL,
  guests INTEGER NOT NULL, guest_name TEXT NOT NULL, guest_email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('confirmed','pending','completed','cancelled','declined','broken')),
  nights INTEGER NOT NULL, accommodation_cents INTEGER NOT NULL, cleaning_cents INTEGER NOT NULL,
  subtotal_cents INTEGER NOT NULL, service_fee_cents INTEGER NOT NULL, tax_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL, host_payout_cents INTEGER NOT NULL, refund_cents INTEGER NOT NULL DEFAULT 0,
  policy TEXT NOT NULL, payment_status TEXT NOT NULL, created_at TEXT NOT NULL, cancelled_at TEXT,
  idempotency_key TEXT UNIQUE, CHECK(from_date < to_date)
);
CREATE INDEX bookings_listing_dates ON bookings(listing_id, from_date, to_date);
CREATE INDEX bookings_guest ON bookings(guest_id, from_date);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id),
  from_date TEXT NOT NULL, to_date TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  CHECK(from_date < to_date)
);
CREATE INDEX blocks_listing_dates ON blocks(listing_id, from_date, to_date);
CREATE TABLE reviews (
  id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES listings(id), guest_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX reviews_listing ON reviews(listing_id, created_at);
CREATE TABLE payouts (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL UNIQUE REFERENCES bookings(id), host_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL, scheduled_date TEXT NOT NULL, paid_date TEXT,
  status TEXT NOT NULL CHECK(status IN ('scheduled','paid','cancelled'))
);
