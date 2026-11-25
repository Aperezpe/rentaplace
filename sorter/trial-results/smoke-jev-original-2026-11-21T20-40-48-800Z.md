# Sorter trial: smoke-jev-original

Set: original. 16 tickets. Keyword rules: 1 run (deterministic). Models: 1 run(s) per ticket. Haiku and Sonnet: thinking off, via Pi CLI. Jev: TypeSafe System One.

Pass = every money ticket safe in every run. Safe = flagged money; for Jev also unsure. Invalid or missing answers count as misses.

Jev rule (in code): money = moneyP >= 0.3; unsure if 0.3 <= moneyP < 0.7 or owner confidence < 0.7.

| Option | Model | Owner accuracy | Money accuracy | Unsure runs | Invalid | Pass |
|---|---|---|---|---|---|---|
| keywords | keyword rules | 75.0% | 68.8% | n/a | 0/16 | **FAIL** |
| haiku | claude-haiku-5-5 | 93.8% | 100.0% | n/a | 0/16 | PASS |
| sonnet | claude-sonnet-5-5 | 93.8% | 100.0% | n/a | 0/16 | PASS |
| jev | jev-1.14.0 | 93.8% | 100.0% | 5/16 | 0/16 | PASS |

## Latency and cost

| Option | Median ms | p95 ms | Max ms | Input tokens | Output tokens | Cost USD |
|---|---|---|---|---|---|---|
| haiku | 840 | 890 | 890 | 64 | 251 | $0.0017 |
| sonnet | 1582 | 1904 | 1904 | 64 | 252 | $0.0335 |
| jev | 160 | 269 | 269 | 7278 | 900 | $0.0003 |

Haiku and Sonnet latency is one Pi CLI process per call, so it includes start-up time. Their cost is what Pi estimates at API prices; the calls run on the Pi sign-in. Jev cost is input tokens at $42 per billion (output is free).

## Money tickets never flagged in any run

For Jev, a run that was unsure counts as caught.

- **keywords: k-01 (double charge, no money word), k-04 (broken heating, wants compensation), k-08 (host payout short, no money word)**

## Misses per ticket

Each cell: owner misses / money misses out of that option's runs, then the most common wrong answer. Blank = no misses.

| Ticket | Kind | Key | keywords | haiku | sonnet | jev |
|---|---|---|---|---|---|---|
| k-01 | double charge, no money word | pricing/true | owner 1/1, money 1/1; said nobody/false **NEVER FLAGGED** |  |  |  |
| k-02 | money word, no money | nobody/false | owner 0/1, money 1/1; said nobody/true |  |  |  |
| k-04 | broken heating, wants compensation | nobody\|pricing/true | owner 0/1, money 1/1; said nobody/false **NEVER FLAGGED** |  |  |  |
| k-06 | date change, price changes | booking\|pricing/true | owner 1/1, money 0/1; said nobody/true |  |  |  |
| k-08 | host payout short, no money word | pricing/true | owner 1/1, money 1/1; said nobody/false **NEVER FLAGGED** |  |  |  |
| k-10 | money word, no money | booking/false | owner 0/1, money 1/1; said booking/true |  |  |  |
| k-13 | damage claim | nobody/true | owner 1/1, money 0/1; said pricing/true | owner 1/1, money 0/1; said pricing/true | owner 1/1, money 0/1; said pricing/true | owner 1/1, money 0/1; said pricing/true |

## Jev per ticket

| Ticket | Kind | Key | moneyP range | Owner confidence range | Unsure runs | Money flagged runs | Caught (flagged or unsure) |
|---|---|---|---|---|---|---|---|
| k-01 | double charge, no money word | pricing/true | 0.83 | 0.49 | 1/1 | 1/1 | 1/1 |
| k-02 | money word, no money | nobody/false | 0.27 | 0.55 | 1/1 | 0/1 | n/a |
| k-03 | slow site | nobody/false | 0.02 | 0.34 | 1/1 | 0/1 | n/a |
| k-04 | broken heating, wants compensation | nobody\|pricing/true | 0.87 | 0.26 | 1/1 | 1/1 | 1/1 |
| k-05 | plain date change | booking/false | 0.05 | 1.00 | 0/1 | 0/1 | n/a |
| k-06 | date change, price changes | booking\|pricing/true | 0.88 | 0.58 | 1/1 | 1/1 | 1/1 |
| k-07 | refund request | pricing/true | 0.90 | 1.00 | 0/1 | 1/1 | 1/1 |
| k-08 | host payout short, no money word | pricing/true | 0.76 | 0.77 | 0/1 | 1/1 | 1/1 |
| k-09 | pending status | booking/false | 0.05 | 1.00 | 0/1 | 0/1 | n/a |
| k-10 | money word, no money | booking/false | 0.09 | 0.98 | 0/1 | 0/1 | n/a |
| k-11 | fee question | pricing/true | 0.90 | 1.00 | 0/1 | 1/1 | 1/1 |
| k-12 | safety, border | nobody\|booking/false | 0.03 | 0.89 | 0/1 | 0/1 | n/a |
| k-13 | damage claim | nobody/true | 0.84 | 0.77 | 0/1 | 1/1 | 1/1 |
| k-14 | deposit by transfer | pricing/true | 0.94 | 0.88 | 0/1 | 1/1 | 1/1 |
| k-15 | host declined | booking/false | 0.04 | 1.00 | 0/1 | 0/1 | n/a |
| k-16 | amenities | nobody/false | 0.03 | 0.83 | 0/1 | 0/1 | n/a |
