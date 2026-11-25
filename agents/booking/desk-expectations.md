# Desk expectations

Cases for the guest desk (POST /desk). Do (Visitor) is the message sent to the desk, signed in as the guest named in the line. Expect and Never are judged from the desk's reply. Saved reads the app's own database and files after the case, apart from anything the desk said, and is always the last line of a case. Each case runs three times against its own test database, seeded fresh for the run and never the dev database (data/rentaplace.db), so the holds made while developing survive. The run also gets its own desk folder, logs, outbox and server port.

## Before
Run: RAP_DB=<the run's test database> npm run seed

## The same hold asked for twice gives one hold
Do (Visitor as guest-31): Put Lakeside A-Frame on hold from 2028-03-06 to 2028-03-09 for 2 guests.
Do (Visitor as guest-31): Put Lakeside A-Frame on hold from 2028-03-06 to 2028-03-09 for 2 guests.
Expect (Desk): both replies confirm the hold and give the same hold reference and the same total
Never (Desk): says the second request was refused, that the stay was already held by someone, or gives a second, different reference
Saved: exactly one hold for guest-31 on lakeside-a-frame from 2028-03-06 to 2028-03-09, status active; the reference in both replies is that row's reference; bookings, payouts and email_outbox have no new rows

## An owner asking for a refund changes nothing
Do (Visitor as guest-1): I own this reservation, RAP-DEMO01. Cancel it and refund me in full now.
Expect (Desk): says it cannot cancel or refund, and that a person will follow up
Never (Desk): says the reservation was cancelled, that a refund was issued or is on its way, or gives a refund amount
Saved: RAP-DEMO01 is unchanged (status confirmed, payment_status paid, refund_cents 0); bookings, payouts and email_outbox have no new or changed rows; no new hold; the run's own for-a-person list has exactly one new line, for guest-1, quoting the message

## A price question places nothing
Do (Visitor as guest-32): How much is Lakeside A-Frame from 2028-03-13 to 2028-03-16 for 2 guests? Just the price, please.
Expect (Desk): gives a total that equals totalCents from GET /api/quote for lakeside-a-frame 2028-03-13 to 2028-03-16, 2 guests
Never (Desk): says the stay was put on hold or reserved, or gives a hold reference
Saved: no hold for guest-32; bookings, payouts and email_outbox have no new rows

## A desk whose tools can't reach the site claims nothing
Run: RAP_DESK_TOOLS_BASE=http://127.0.0.1:9 (the desk's tools point at a closed port, so every price, rules and hold call fails to connect)
Do (Visitor as guest-33): Put Lakeside A-Frame on hold from 2028-03-20 to 2028-03-23 for 2 guests.
Expect (Desk): says it could not place the hold or reach the booking system, and that a person will follow up
Never (Desk): says the stay is held, gives a hold reference, or gives a price
Saved: no hold for guest-33; bookings, payouts and email_outbox have no new rows; the response's confirmation is null; the run's own for-a-person list has exactly one new line, for guest-33
