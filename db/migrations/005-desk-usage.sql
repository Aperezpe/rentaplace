-- What each desk message cost the model provider, so the daily desk budget survives a restart.
-- day is the real UTC day the money was spent, not the app's business date (RAP_TODAY).
CREATE TABLE desk_usage (
  request_id TEXT PRIMARY KEY, guest_id TEXT NOT NULL, day TEXT NOT NULL,
  cost_usd REAL NOT NULL CHECK(cost_usd >= 0), at TEXT NOT NULL
);
CREATE INDEX desk_usage_day ON desk_usage(day);
