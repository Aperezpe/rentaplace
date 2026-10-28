# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Guests and hosts, with equal weight. *(Inferred from the README and the shipped pages; not yet confirmed by the owner.)*

- **Guests** look for a whole home for a short getaway: they search by region and dates, compare prices, reserve with a demo payment, manage trips and cancellations, and ask for help.
- **Hosts** run one home or a large collection: they edit listings, keep calendars, review booking requests, and export payouts.
- **The operating team** uses the local operations page (`/admin`) for health, flags, logs, support questions and page feedback.

## Product Purpose

A vacation rental marketplace for finding a place, planning a stay, and welcoming guests. Success means a guest can go from search to a confirmed stay with a clear, complete price, and a host can see what is booked, pending and paid without hunting.

## Positioning

Quiet, nature-first stays (cabins, cottages, lofts) with prices that are clear from the start and a whole place to yourself. *(Taken from the shipped copy; not yet confirmed as a binding position.)*

## Operating Context

- Everything runs on one local machine: Node 24 or 25, SQLite, a native HTTP API and Next.js pages served by the same process.
- The JSON API (`/api/openapi.json`) and the `rap` command line read and write through the same domain functions as the pages.
- The business date is fixed at 2026-11-09 (`RAP_TODAY`), so availability and refunds are reproducible.
- Work in progress is tracked in `tracker/board.json`.

## Capabilities and Constraints

- Money is integer USD cents; dates are ISO dates with exclusive checkout.
- Payments are demo only (card 4242 4242 4242 4242, never stored). Confirmation emails are local outbox files. No telemetry, remote assets or external email.
- Booking creation, payout scheduling and the confirmation outbox are written in one transaction.
- Host and guest ownership checks protect every page and API route.
- Guests can choose a light or dark theme; it starts from the device setting and remembers the choice.

## Brand Commitments

- Name: **RentAPlace**, with the house mark in `public/img/brand/`.
- Voice: calm and warm, short sentences, an invitation rather than a sales pitch ("Find your kind of away.").
- Honesty about the data: the business is fictional and treated as real. Every page says plainly that homes, hosts and guests are fictional and photos are AI-generated, while every design decision is made as if real guests and hosts used it. *(Inferred; not yet confirmed by the owner.)*

## Evidence on Hand

- A fixed seed: 700 homes, 120 hosts, 3,000 guests, 10,002 reservations and 4,200 reviews across 14 real regions with invented neighbourhoods (`data/seed.ts`).
- AI-generated home photos, portraits and scenery in `public/img/`.
- There are no real customers, testimonials, reviews, press or revenue. Never present seeded reviews or totals as real.

## Product Principles

*(Inferred from the shipped product; confirm or edit.)*

1. The price a guest sees first is the price they pay; every fee is shown before checkout.
2. Guests and hosts get equal care; a host tool is never an afterthought.
3. Pages, API and command line do the same thing through the same rules.
4. Calm beats busy: one clear next step per screen.
5. Fictional, never fake: the data is invented, the behaviour is real.

## Accessibility & Inclusion

WCAG 2.1 AA in both themes, at phone and desktop widths: named controls, visible focus, touch targets of at least 44 pixels, and readable contrast over photographs.
