# Hunts: the error hunter's card

One card per hunt, read from the hunter host's own store (`host.db`): did it replay the logged error, the rule in the hunter's words, then by request number what **fails**, what **still works**, and what the hunter asked that it listed in **neither**. A hunt with no report yet shows as "Hunting…". Enter sends the selected report to Main.

No model is called by the card: the hunter already wrote the report. The card is plain code. It shows a request only if the host recorded it for that hunt, with the store's own method, path and status; a number the report lists that the store does not back is dropped and the card says how many were dropped. The rule and the notes are the hunter's words, shown as written. The store does not record what the hunter did not try: that is only in its notes.

## Try it without Herdr

```sh
node hunter/card/hunts.mjs show --store <path to host.db>
node hunter/card/hunts.mjs act <hunt id> send-main --terminal <address> --dry   # prints what Enter would send
```

## Install (you run this; nothing installs itself)

`sh hunter/card/install.sh` copies the card into `${HERDR_APP_HOME:-~/.config/herdr-app}/mods/hunts` and checks it. Then add `{"type": "block", "content": {"mod": "hunts"}}` to a layout column.

## Settings

The same convention as Todos, Memories and Issues: default, then `~/.config/herdr-hunts/config.json` (or `HERDR_HUNTS_CONFIG`), then `<project>/.herdr/hunts.json`, then the environment (`HERDR_HUNTS_STORE`, …).

| Key | Default | Meaning |
|---|---|---|
| `store` | `hunter/host.db` | The hunter host's database file (absolute, or relative to the project) |
| `refreshSeconds` | `10` | Seconds between reads of the store |
| `maxHunts` | `20` | How many hunts are shown, newest first |

`node hunts.mjs config` (the values and where each came from), `config set <key> <value> [--project]`, `config path`. There is no `model` key because the card calls no model.

## Keys

↑/↓ select a hunt · Enter send it to Main · R read the store now · Tab next widget · − collapse · Shift+O pop out · Shift+W close · Shift+arrows move · Esc back.

## Check

`sh hunter/card/fence.sh` (syntax, the shared rules' types, 24 tests).
