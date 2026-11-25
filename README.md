# drinkinggame

A party game for a group of friends, played in the browser on everyone's phone. No app to install and no accounts: open a link, pick a nickname and a picture, and play.

> "drinkinggame" is a working title.

## How it plays

1. Everyone sets up a profile: a nickname and an emoji avatar, or a selfie.
2. One person hosts a game and gets a short game key and a QR code. Up to 25 players join by scanning the code or typing the key.
3. The host picks the game length (15, 25 or 35 questions), whether to add the Spicy and Luuppi questions to the default ones, and the game mode.
4. Each question ("Who is most likely to ...?") shows up on every phone with some of the players, and everyone privately ranks them before the timer runs out.
   - **Spotlight** (default): everyone is shown if there are 6 or fewer players, otherwise 5 at random, and you rank them all.
   - **Podium** (7 or more players): everyone is shown every time and you pick your top 3.
5. The group's combined ranking is revealed place by place, with a drinking rule for each revealed place, then the full ranking. The host taps Next for the next question. No question repeats within a game.

Only places are shown, never vote counts, so nobody can tell who voted for whom.

## Tech

- **Client:** Preact + signals, TypeScript, plain CSS with design tokens, built with Vite.
- **Server:** Cloudflare Workers + Durable Objects, one object per game. All phones of a game talk to that one object over WebSockets, and it holds the game state (saved to its own storage, so a deploy or restart mid-game doesn't lose the game).
- **Hosting:** runs within the Cloudflare free plan.
- **Tests:** Vitest (game logic, client logic, and the Worker in the real Workers runtime) and Playwright (several emulated phones playing together).

Source layout:

| Folder           | What's in it                                                                           |
| ---------------- | -------------------------------------------------------------------------------------- |
| `src/game/`      | The game rules as pure functions (no I/O, no clock, no randomness of its own)          |
| `src/shared/`    | Message schemas, limits and timings, and helpers used by both the phone and the server |
| `src/server/`    | The Worker (HTTP routes) and the Durable Object that runs a game                       |
| `src/client/`    | The phone app: design tokens, UI components, screens, connection and store             |
| `src/questions/` | The question bank (JSON)                                                               |
| `test/`, `e2e/`  | Unit and integration tests, and multi-phone browser tests                              |

## Getting started

You need **Node.js 26** (see `.nvmrc`) and npm.

```sh
npm ci
npm run dev
```

Open the address it prints (usually http://localhost:5173). To play alone, open the join link in a private window or another browser: each window counts as a separate phone. A game needs 3 players to start.

While `npm run dev` is running there are also a few dev pages (dev and staging builds only, never in production):

- `/dev/ui`: every UI component, in light and dark mode
- `/dev/screens`: every game screen with example data
- `/dev/ranking`: the ranking screen with made-up players, for trying it on a phone

## Scripts

| Command               | What it does                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run dev`         | Client, Worker and Durable Object together in the real Workers runtime                             |
| `npm test`            | All unit and integration tests                                                                     |
| `npm run test:watch`  | Tests in watch mode                                                                                |
| `npm run typecheck`   | TypeScript, every part of the project                                                              |
| `npm run lint`        | ESLint, Stylelint and Prettier                                                                     |
| `npm run check`       | Typecheck, lint and tests: run this before calling anything done                                   |
| `npm run test:e2e`    | Playwright tests with emulated iPhone and Android phones (starts the dev server itself)            |
| `npm run test:csp`    | The production build under the real Content Security Policy                                        |
| `npm run smoke [url]` | Three scripted phones play one real round against a running server (default http://localhost:5173) |
| `npm run format`      | Format everything with Prettier                                                                    |
| `npm run cf-typegen`  | Regenerate `worker-configuration.d.ts` after changing `wrangler.jsonc`                             |

Always run tests through `npm test` / `npm run test:watch`, not `npx vitest` (see the Windows notes below).

## Deploying

There are two Cloudflare environments, chosen at build time:

| Command                  | Where it goes                                                     |
| ------------------------ | ----------------------------------------------------------------- |
| `npm run deploy:staging` | The staging Worker on `*.workers.dev`, for testing on real phones |
| `npm run deploy`         | Production                                                        |

Both run `npm run check` first, so a broken build can't be deployed. You need to be logged in with Wrangler (`npx wrangler login`).

Test on real phones against **staging**, not against `http://<your-computer's-ip>:5173`. Phones need HTTPS for things like keeping the screen awake, so a plain local address gives misleading results.

## Questions

The questions live in `src/questions/questions.json`. Each one has an id, the text, a category (`default`, `spicy` or `luuppi`) and optionally `"labels": "most"` when it isn't a "most likely" question. A question may contain `[player]` once; a player's name goes there in the game.

The bank is checked by a test: it needs at least 35 default questions, unique ids and texts, and known categories. The server only reads the bank when a game starts, so editing questions never breaks a game in progress.

## Windows notes

- **Vitest and lowercase drive letters:** starting Vitest from a `c:\...` path (VS Code's terminal often does this) makes every test fail with "Cannot read properties of undefined (reading 'config')". `scripts/vitest.mjs` fixes the drive letter, which is why tests go through `npm test`.
- **Smart App Control** blocks some unsigned `workerd.exe` builds. The project pins one Workers runtime version that runs (via `overrides` in `package.json`). Before upgrading Wrangler or workerd, check that the new `node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe --version` runs.
