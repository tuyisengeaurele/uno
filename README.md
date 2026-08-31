# UNO

Real-time multiplayer UNO for the browser. Create a room, share the code, and
play with 2 to 10 people. Full official rules, configurable house rules, bots for
solo play, and reconnect handling so a dropped connection does not end the game
for everyone else.

The game state lives on the server. The client renders it and sends intents. Every
move is validated server-side, so opening devtools does not help you cheat.

## Status

Early development. The rules engine is the first milestone. See
[docs/plans/2026-08-31-game-engine.md](docs/plans/2026-08-31-game-engine.md) for
what is being built now and [docs/specs](docs/specs) for the design decisions
behind it.

## Repo layout

```
packages/
  engine/       Pure game logic. No network, no I/O, no framework. Fully tested.
apps/
  server/       Express + Socket.IO. Room lifecycle, move validation, persistence.
  web/          React + Vite client.
packages/
  contracts/    Shared zod schemas and types for socket events.
```

`apps/` and `packages/contracts` land in later milestones. Each is added in its own
pull request.

## Prerequisites

- Node 22 (`.nvmrc` is set; `nvm use` picks it up)
- pnpm 9 (`corepack enable` installs the pinned version)
- Docker, for running Postgres and Redis locally once the backend exists

## Setup

```bash
pnpm install
cp .env.example .env   # fill in values as backend milestones land
```

## Scripts

Run from the repo root. Each fans out across every workspace package.

| Command             | What it does                 |
| ------------------- | ---------------------------- |
| `pnpm lint`         | ESLint across the tree       |
| `pnpm format`       | Prettier write               |
| `pnpm format:check` | Prettier check, no writes    |
| `pnpm typecheck`    | `tsc --noEmit` per package   |
| `pnpm test`         | Test suites per package      |
| `pnpm build`        | Production build per package |

To work on the engine alone:

```bash
pnpm --filter @uno/engine test
pnpm --filter @uno/engine test:watch
```

## Technical choices

**pnpm workspaces, one repo.** The engine, the server, and the client share types:
card shapes, the socket event contract, the game state that goes over the wire.
Those need to change together in a single commit. Splitting into multiple repos
would trade that for version coordination we do not want to do.

**Socket.IO, not raw `ws`.** We need reconnection with backoff, acknowledgement
callbacks so a client knows whether its move was accepted, a rooms primitive, and
a path to horizontal scaling. Socket.IO ships all four. The Redis adapter is the
documented way to run more than one instance. Raw `ws` means building each of
these by hand.

**Zustand for client state.** The server owns the game. The client store is mostly
a projection of server snapshots plus a little local UI state: which card is
selected, which animation is mid-flight. Zustand fits that shape without the
reducer and action-creator layer that Redux Toolkit asks for. RTK earns its
structure when the client drives complex state transitions itself, which this
client does not.

**In-memory room store, Redis-ready.** Room and game state sits behind a store
interface with an in-memory implementation. One backend instance handles a large
number of concurrent rooms. When we need more than one instance, the Redis
implementation of that same interface is the swap, along with the Socket.IO Redis
adapter.

**Fly.io for the backend, Vercel for the frontend.** The backend holds WebSocket
connections and in-memory game state, so it wants a stateful host with long-lived
processes and regional placement. Fly.io provides that and runs Postgres and Redis
next to it. The frontend is a static build and deploys to Vercel.

## Security

- Every socket event and REST endpoint validates its payload with a zod schema.
- Rate limits on room creation, chat, and reconnect attempts.
- CORS is pinned to the deployed frontend origin.
- Helmet sets the HTTP security headers.
- Secrets come from environment variables. `.env` is gitignored; `.env.example`
  documents every key.
- `pnpm audit` runs in CI. It is advisory today and becomes blocking once the
  dependency set stops moving. High and critical findings are triaged within a
  week: patch, replace, or document why the path is not reachable.

## Contributing

- Conventional commits, enforced by commitlint: `feat`, `fix`, `chore`,
  `refactor`, `test`, `docs`, `ci`, `perf`, `build`, `style`.
- Branch names: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`.
- `main` is protected. Work lands through pull requests.
- husky runs lint-staged on commit and checks the message format.
