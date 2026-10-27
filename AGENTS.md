# RentAPlace

A local vacation rental marketplace built with Node 24+, erasable TypeScript, native HTTP and SQLite. No dependency installation or compilation is required.

- `npm run dev` starts the server. `npm run seed` resets the local database; stop the server first.
- Run `npm test`, `npm run bench`, and `npm run journey` against a running server.
- Money is integer USD cents. Dates are ISO dates with exclusive checkout. Use `RAP_TODAY`, not the wall clock, for business dates.
- Keep booking creation, payout scheduling, and confirmation outbox inserts in one transaction.
- Keep page output escaped and preserve host and guest ownership checks.
- Module boundaries and review responsibilities are in `docs/architecture.md`.
- Change the implementation to satisfy an assertion when the assertion describes the correct user-visible behavior.
