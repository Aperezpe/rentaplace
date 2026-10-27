# 0002 — Save the price when the guest books

Date: 2026-10-27

## Decision

Calculate each night independently, use integer cents, and save the entire price and cancellation policy on the reservation. Use the saved values for cancellation and payouts.

## Why

A host editing future prices must not change an existing guest's receipt. A quoted total must agree with the amount shown at checkout, and money must not drift through floating-point arithmetic.

## Consequences

The three-weeknight Lakeside A-Frame stay on November 9–12 costs 33,000 cents for nights plus 6,000 cents for cleaning: a 39,000-cent subtotal. Service fee and occupancy tax are separate. Tests protect this amount. Reservation creation and payout/outbox scheduling commit together.
