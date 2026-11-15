# Booking glossary

What a word means inside reservations. Short on purpose. The site-wide words are in `GLOSSARY.md`; when the two disagree, fix one in the same change.

- **Hold**: not a separate feature. The code has no hold table, no hold status and no timer. "Hold" is our word for what a reservation does from the moment the guest reserves, while it is still pending and after it is confirmed: it holds its nights and it locks its price. An active hold locks the quoted price: every amount (nights, cleaning, service fee, tax, total, host share) is saved on the reservation when it is made, and nothing re-prices it afterwards. If a host raises prices while a hold is active, the guest still pays the saved total; only new quotes use the new prices. A hold also keeps the nights: no other reservation or host block can take them. (Code: `createBooking` in `src/domain/bookings.ts`; `test/hold-price.test.ts`.)
- **Active hold**: the hold of a reservation that is pending or confirmed. A completed stay still keeps its past nights. Declined and cancelled reservations hold nothing. There is no timer: a hold does not expire by itself after 24 hours or any other time. (Code: `assertAvailable`.)
- **Pending**: requested, waiting for the host. The payment is authorized, not paid. The host accepts (it becomes confirmed, at the saved price) or declines (full refund, nights free).
- **Reservation**: a guest's claim on a listing for a stay. Code and tables say `booking`; everything a guest or host reads says "reservation".
- **Checkout** (the date): the day the guest leaves. It is exclusive, so another stay may check in that day.
- **Checkout** (the action): reserving with the demo payment. The reservation, the payout schedule and the confirmation message are saved together or not at all.
