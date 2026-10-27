# Contributing

Keep changes focused on a user-visible problem. Describe the observed behavior, the desired result, and how you checked it. Preserve the zero-dependency stack and direct TypeScript execution on Node 24 and 25.

## Before a change

1. Read the relevant domain module and its tests.
2. Reproduce the behavior with the API, CLI, or browser.
3. Check the board and relevant ownership boundary.

## Before a review

- Run `npm test`.
- Start the server and run `npm run journey`.
- For search changes, retain the output from `npm run bench` and compare the returned results as well as time.
- For pricing changes, explain amounts in cents and verify the complete checkout total.
- For UI changes, check a wide browser and a 390px viewport; use the keyboard as well as the pointer.
- Add migrations in order. Do not edit an already applied migration.
- Do not commit the database, logs, local signing key, or confirmation outbox.

Use ordinary, specific commit messages. Keep fixture data fictional and use `example.test` addresses. The local sign-in picker is for demonstration, not production authentication.
