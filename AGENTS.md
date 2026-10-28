# RentAPlace

A local vacation rental marketplace built with Node 24+, erasable TypeScript, native HTTP and SQLite. Pages are Next.js (App Router) with Tailwind CSS and shadcn/ui components. Run `pnpm install` once.

- `npm run dev` starts the server. `npm run seed` resets the local database; stop the server first.
- Run `npm test`, `npm run bench`, and `npm run journey` against a running server.
- Money is integer USD cents. Dates are ISO dates with exclusive checkout. Use `RAP_TODAY`, not the wall clock, for business dates.
- Keep booking creation, payout scheduling, and confirmation outbox inserts in one transaction.
- Keep page output escaped and preserve host and guest ownership checks.
- Module boundaries and review responsibilities are in `docs/architecture.md`.
- Change the implementation to satisfy an assertion when the assertion describes the correct user-visible behavior.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
- UI: pages live in `app/`, shared components in `web/components/` (shadcn/ui primitives in `web/components/ui/`, added with `pnpm dlx shadcn@latest add <name>`). Pages read data through the same domain functions as the JSON API (`src/domain/`). Theme tokens are in `app/globals.css`. Light and dark themes share the same token names (dark values under `.dark`); the header toggle saves the choice in localStorage `rentaplace-theme`, and without a saved choice the page follows the device setting.
- `npm run typecheck` checks types; `npm run build` builds the pages for `npm start`.
