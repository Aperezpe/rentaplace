# Local runbook

## Start and inspect

Run `npm run dev` for watch mode or `npm start` for a steady process. The default bind address is `127.0.0.1:5180`. A missing database is migrated and seeded automatically. The readiness log has `event: server.started`; health is available at `/api/health`.

If the port is occupied, leave the existing process alone and choose another:

```sh
PORT=5282 npm run dev
RAP_URL=http://127.0.0.1:5282 npm run journey
RAP_URL=http://127.0.0.1:5282 npm run rap -- doctor --json
```

If page edits stop reloading in development, the system may not be delivering file-change events. Start with `RAP_WATCH_POLL_MS=1000 npm run dev` to check for changes every second instead.

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
| `RAP_WATCHER_DIR` | `data/watcher/` | Support watcher bookmark, lock and support-tags.jsonl |
| `RAP_LOG_STDOUT` | Enabled | Set `0` to retain file logs without stdout output |

Stop the server before `npm run seed`. This restores the deterministic catalog and reservations. It does not remove earlier logs or outbox files; those are ignored by git and can be archived separately when needed.

## Reading an incident

`/admin` shows recent HTTP errors, requests above 200 ms, flags, support, and feedback. `logs/app.log` is JSONL with a request ID on every request. A request includes method, path, status, milliseconds, and the real time it was written (not `RAP_TODAY`). Domain events include booking creation/cancellation, payout scheduling, listing updates, and support receipt.

A confirmation write failure leaves its row pending. Check that `RAP_OUTBOX_DIR` is writable, then restart the server to retry. The booking remains durable in SQLite.

For a problem that only appears while using a page, inspect browser behavior as well as request logs. For payment questions, inspect the integer price snapshot on the reservation; never collect real card details.

## Support watcher

`npm run watcher` runs a separate process that tails `logs/app.log` and, for each `support.received` ticket ID, asks Jev (TypeSafe, key `TYPESAFE_API_KEY` in `.env`) who owns it and whether money is involved. It reads the ticket read-only and appends one tag to `data/watcher/support-tags.jsonl` (ticketId, owner, money, unsure, why, moneyP, ownerConfidence, model, at). The rule is in `src/jev.ts`: money when moneyP >= 0.30; unsure when moneyP is 0.30 to 0.70 or owner confidence is below 0.70.

The bookmark (`data/watcher/bookmark.json`) moves only after the tag is saved. A ticket in `done`, or one that already has a tag, never goes to Jev again. If Jev is unreachable or answers something invalid, no tag is written, the bookmark stays, the watcher prints `sorter.offline` and retries the same line with backoff (5 s doubling to 60 s); later tickets wait behind it. The app does not depend on the watcher: guests get their reply whether it is running or not.

## Error hunter

The watcher also starts the error hunter for every failed request (status 500 or above) and every `outbox.failed` or `server.failed` event. `request.failed` is skipped because it always comes with its own status-500 request line. Each failure ID gets one hunt and one report in `data/hunts/reports/<id>.md`; a failure that already has a report or a hunt is skipped. A hunt copies the app code and a snapshot of the database into `data/hunts/work/<id>/`, starts that copy on a free port with pages off, replays the logged request (#1), then tries dates shifted by up to a week, other homes (same region first) and other guest counts. Values the log does not keep (demo test card, test guest, the signed-in account) are filled in and named in the report. Code counts the outcomes (failed, worked, neither); Haiku writes the summary, and claims citing a request number not in the record are dropped. Hunts run on pi-durable over `data/hunts/hunts.sqlite`, so a restart continues the same hunt. Report only: it never fixes or edits anything.
