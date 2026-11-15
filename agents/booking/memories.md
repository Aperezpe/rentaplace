# Booking memories

Why reservations work the way they do. One line each, newest decisions win, every line names where it came from. No raw transcripts.

## Internal engineering

- The whole price and the cancellation policy are saved on the reservation row when the guest books, and cancellation and payouts read the saved values, never the listing's current prices. (decision `docs/decisions/0002-reservation-money.md`, 2026-10-27; commit f440195)
- Reservation, payout schedule and confirmation outbox row commit in one transaction; a failed confirmation insert rolls back all three. (commit 374848f; test "a failed confirmation insert rolls back the booking and payout together" in `test/bookings.test.ts`)
- Accepting a pending request only changes status and payment status; it does not call pricing again. Only a pending request can be accepted or declined. (commit b35a9dd; `respondToReservation` in `src/domain/bookings.ts`)
- A partial refund keeps the host's share of the accommodation that was retained; a full refund cancels the payout. (commit e61b46a; test added in ccdfb16)
- A repeated idempotency key returns the existing reservation only if guest, home, dates and guest count agree; otherwise it is refused. The replay lookup is the first step inside the checkout transaction, ahead of `assertAvailable`, because a retry's own reservation already holds its nights. Any refusal placed ahead of that lookup turns the retry of a checkout that already succeeded into an error. (commit 374848f; `createBooking` in `src/domain/bookings.ts`; test "idempotent checkout creates one booking and refuses a mismatched retry" in `test/bookings.test.ts`; `docs/architecture.md`, Persistence)
- A hold is its own row in `holds`, never a reservation status. It has no payment, payout or confirmation row, so nothing about money has to be undone when it runs out. (commit eba6d8c; test "placing a hold needs a signed-in guest and moves no money" in `test/holds.test.ts`)
- A hold's expiry is a comparison with the clock passed to the function (`expires_at > clock`), not a background job: nothing has to run for the nights to come free, and tests pass a later clock instead of waiting. (commit eba6d8c; test "a hold expires 24 hours after it was placed, by the clock passed in" in `test/holds.test.ts`; `docs/architecture.md`, Persistence)
- `assertAvailable` is the one place that decides whether nights are taken: reservations, host blocks and other guests' active holds. A guest's own hold on exactly that stay is not a conflict, and when that guest reserves, the reservation is saved at the hold's amounts and the hold becomes `converted`. (commit eba6d8c; `createBooking` in `src/domain/bookings.ts`; test "a hold locks the price quoted when it was placed, also when its guest reserves" in `test/holds.test.ts`)
- A hold needs the guest's own sign-in, and a guest can hold a given stay once, also after releasing it, so made-up accounts and repeats cannot keep a calendar closed. A repeated request key returns the hold placed earlier; the lookup comes first in `placeHold`, as in checkout. (commit eba6d8c; tests "one hold per guest and stay: a second request is refused, also after release" and "a repeated request with the same request key places one hold; a different request under that key is refused" in `test/holds.test.ts`)
- Open bug: a closed home can still reach checkout. `assertAvailable` checks reservations, blocks and holds, not the listing's status. Expected behaviour for existing reservations is not decided. A new hold on a home that is not active is already refused. (tracker card `closed-home-booking`, To do; commit eba6d8c, test "a hold cannot take nights a reservation or a block already holds, or a home that is not active" in `test/holds.test.ts`)

## Customer-facing

- The first price a guest sees is the price they pay: a host editing future prices must not change an existing guest's receipt. (decision `docs/decisions/0002-reservation-money.md`; `GLOSSARY.md`, Quote)
- A guest can hold a stay for 24 hours before reserving: the nights and the quoted price are kept, nothing is charged, and reserving within that time costs the held price. (commit eba6d8c; `GLOSSARY.md`, Hold; `docs/api.md`, Price and availability)
- A pending reservation is always refunded in full when the guest cancels or the host declines. (`GLOSSARY.md`, Refund; commit 374848f)
- Guests and hosts read "reservation", never "booking". (`GLOSSARY.md`, Words to avoid; commit cc7c390)
- Minimum stay has no meaning yet: nights, homes, start date and what happens to existing reservations are product decisions still open. Do not build on a guess. (tracker card `holiday-stay-length`, On hold)
- A guest disputed a moderate-policy refund five days before check-in; reproduce the amount at that date before changing code or copy. (tracker card `refund-window`, Checking)
