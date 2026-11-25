-- A home's published rules, one passage per topic. No row means the home publishes nothing on that topic.
-- Guest count and cancellation are not stored here: they are published listing fields (sleeps, cancellation_policy).
-- Seed data only for now: no host form writes this table. The INSERTs below match publishSeedRules in src/domain/rules.ts.
CREATE TABLE listing_rules (
  listing_id TEXT NOT NULL REFERENCES listings(id), topic TEXT NOT NULL CHECK(topic IN ('check_in_out','smoking','quiet_hours','pets')),
  text TEXT NOT NULL CHECK(length(text) > 0), updated_at TEXT NOT NULL,
  PRIMARY KEY (listing_id, topic)
);
INSERT INTO listing_rules SELECT id,'check_in_out','Check-in after 3 pm. Check-out by 11 am.',updated_at FROM listings;
INSERT INTO listing_rules SELECT id,'smoking','No smoking indoors.',updated_at FROM listings;
INSERT INTO listing_rules SELECT id,'quiet_hours','Quiet hours 10 pm to 8 am.',updated_at FROM listings;
INSERT INTO listing_rules SELECT id,'pets','Pets welcome; please include them in your note to support.',updated_at FROM listings WHERE amenities LIKE '%"Pet friendly"%';
