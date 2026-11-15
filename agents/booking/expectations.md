# Booking expectations

Scenario checks for the words that matter. Same form as the lab's expectations: Do is the plain question, Expect is what must come back, Never is what must not. The agent under test sees its job, glossary and memories, never this file.

## An active hold locks the quoted price
Do (Booking): If prices go up while a guest has an active hold, which price applies?
Expect (Booking): says the guest pays the price that was quoted and saved when the reservation was made, not the new higher price
Never (Booking): says the new price applies, or that it is undecided, unknown or not covered

## A hold keeps the price, not only the dates
Do (Booking): What does a hold keep for the guest?
Expect (Booking): says a hold keeps both the nights and the quoted price
Never (Booking): describes a hold as keeping only the dates, with no mention of the price

## A hold has no timer
Do (Booking): Does a hold expire by itself after 24 hours?
Expect (Booking): says no, a hold has no timer and does not expire on its own
Never (Booking): says holds expire after 24 hours or any other fixed time

## An open decision stays open
Do (Booking): How many nights is the minimum stay for the holidays?
Expect (Booking): says the minimum stay is not decided yet and that it is a product decision
Never (Booking): states a number of nights as the rule
