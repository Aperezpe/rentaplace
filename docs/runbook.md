# Local runbook

## Start and inspect

Run `npm run dev` for watch mode or `npm start` for a steady process. The default bind address is `127.0.0.1:5180`. A missing database is migrated and seeded automatically. The readiness log has `event: server.started`; health is available at `/api/health`.

If the port is occupied, leave the existing process alone and choose another:

```sh
PORT=5282 npm run dev
RAP_URL=http://127.0.0.1:5282 npm run journey
RAP_URL=http://127.0.0.1:5282 npm run rap -- doctor --json
```

## Checks

```sh
npm test
npm run check:types
npm run bench
npm run journey
```

The journey needs a running server. It finds an available three-night Lakeside A-Frame window, creates and cancels a reservation, submits support and feedback, blocks and unblocks dates, and checks host payouts. It leaves cancelled reservation history plus its support and feedback records for inspection. It may be run more than once.

## Application date and storage

| Setting | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5180` | Loopback HTTP port |
| `RAP_TODAY` | `2026-11-09` | Business date; `now` uses the current UTC date |
| `RAP_URL` | `http://127.0.0.1:5180` | CLI and journey server URL |
| `RAP_DB` | `data/rentaplace.db` | Optional database path |
| `RAP_LOG_DIR` | `logs/` | Structured request and domain logs |
| `RAP_OUTBOX_DIR` | `outbox/` | Local confirmation JSON files |
| `RAP_SESSION_SECRET` | Local random `data/session.key` | Optional signing secret; never commit it |
| `RAP_LOG_STDOUT` | Enabled | Set `0` to retain file logs without stdout output |

Stop the server before `npm run seed`. This restores the deterministic catalog and reservations. It does not remove earlier logs or outbox files; those are ignored by git and can be archived separately when needed.

## Reading an incident

`/admin` shows recent HTTP errors, requests above 200 ms, flags, support, and feedback. `logs/app.log` is JSONL with a request ID on every request. A request includes method, path, status, milliseconds, and application time. Domain events include booking creation/cancellation, payout scheduling, listing updates, and support receipt.

A confirmation write failure leaves its row pending. Check that `RAP_OUTBOX_DIR` is writable, then restart the server to retry. The booking remains durable in SQLite.

For a problem that only appears while using a page, inspect browser behavior as well as request logs. For payment questions, inspect the integer price snapshot on the reservation; never collect real card details.
