# Booking memories

Why reservations work the way they do. One line each, newest decisions win, every line names where it came from. No raw transcripts.

## Internal engineering

- The whole price and the cancellation policy are saved on the reservation row when the guest books, and cancellation and payouts read the saved values, never the listing's current prices. (decision `docs/decisions/0002-reservation-money.md`, 2026-10-27; commit f440195)
- Reservation, payout schedule and confirmation outbox row commit in one transaction; a failed confirmation insert rolls back all three. (commit 374848f; test "a failed confirmation insert rolls back the booking and payout together" in `test/bookings.test.ts`)
- Accepting a pending request only changes status and payment status; it does not call pricing again. Only a pending request can be accepted or declined. (commit b35a9dd; `respondToReservation` in `src/domain/bookings.ts`)
- A partial refund keeps the host's share of the accommodation that was retained; a full refund cancels the payout. (commit e61b46a; test added in ccdfb16)
- A repeated idempotency key returns the existing reservation only if guest, home, dates and guest count agree; otherwise it is refused. The replay lookup is the first step inside the checkout transaction, ahead of `assertAvailable`, because a retry's own reservation already holds its nights. Any refusal placed ahead of that lookup turns the retry of a checkout that already succeeded into an error. (commit 374848f; `createBooking` in `src/domain/bookings.ts`; test "idempotent checkout creates one booking and refuses a mismatched retry" in `test/bookings.test.ts`; `docs/architecture.md`, Persistence)
- Open bug: a closed home can still reach checkout. `assertAvailable` checks reservations and blocks, not the listing's status. Expected behaviour for existing reservations is not decided. (tracker card `closed-home-booking`, To do)

## Customer-facing

- The first price a guest sees is the price they pay: a host editing future prices must not change an existing guest's receipt. (decision `docs/decisions/0002-reservation-money.md`; `GLOSSARY.md`, Quote)
- A pending reservation is always refunded in full when the guest cancels or the host declines. (`GLOSSARY.md`, Refund; commit 374848f)
- Guests and hosts read "reservation", never "booking". (`GLOSSARY.md`, Words to avoid; commit cc7c390)
- Minimum stay has no meaning yet: nights, homes, start date and what happens to existing reservations are product decisions still open. Do not build on a guess. (tracker card `holiday-stay-length`, On hold)
- A guest disputed a moderate-policy refund five days before check-in; reproduce the amount at that date before changing code or copy. (tracker card `refund-window`, Checking)
