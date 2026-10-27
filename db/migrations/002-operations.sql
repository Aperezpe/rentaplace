CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), name TEXT NOT NULL, email TEXT NOT NULL,
  subject TEXT NOT NULL, message TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'uncategorized',
  owner_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), page TEXT NOT NULL, rating TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE flags (name TEXT PRIMARY KEY, enabled INTEGER NOT NULL, description TEXT NOT NULL);
CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL
);
