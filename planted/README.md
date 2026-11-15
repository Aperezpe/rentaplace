# Planted bug (on purpose, for Day 4)

RentAPlace has no natural server error, so Day 4's error hunt needs one made on purpose.
`bug-a-december.patch` adds a seasonal-rate table with **no December row**: any quote or booking whose stay includes a December night answers 500.

It is never applied to this project. `node planted/make-broken-copy.mjs <folder>` writes a copy of the tracked files to `<folder>` and applies the patch there. The copy gets a `PLANTED-BUG.md` saying what was broken. Run a copy with `node hunter/serve.mjs <folder>` (its own database, log and outbox folders; mail goes to the outbox folder, the card is a demo card).
