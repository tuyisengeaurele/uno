# Realtime layer design

Status: approved
Date: 2026-08-31
Scope: the multiplayer transport (delivery step 3)

## What this milestone builds

A Socket.IO server that runs games on top of the tested engine. Rooms with
shareable codes, server-authoritative move validation, redacted per-player state,
reconnect handling, presence, and a turn timer. No UI beyond integration tests.

Out of scope, each its own later milestone: the React client, Postgres and match
history, in-game chat, bots.

## New workspace members

- **`packages/contracts`**: the wire contract. zod schemas for every inbound
  payload, TypeScript types for every outbound event, and the redacted view
  shapes. Depends on `@uno/engine`. Imported by the server now and the client
  later.
- **`apps/server`**: Express plus Socket.IO plus TypeScript.

## Engine change

The engine's `Rng` is an opaque stateful closure. A room needs its RNG position
inside its serializable state so a snapshot is complete and can later move to
Redis. Add:

- `createRng(seed: number, state?: number): Rng`
- `rng.state: number` getter returning the current internal value

mulberry32's state is a single uint32, so this is a two-line change plus tests.
A room then stores `{ seed, rngState }` and rebuilds the RNG for each action.

## The Room aggregate

```ts
type RoomPhase = 'lobby' | 'active' | 'finished';

interface Seat {
  id: string; // also the engine playerId
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
}

interface Spectator {
  id: string;
  name: string;
}

interface Room {
  code: string;
  hostSeatId: string;
  phase: RoomPhase;
  seats: Seat[]; // ordered, 2 to 10
  spectators: Spectator[];
  houseRules: HouseRules;
  turnTimerSeconds: number | null;
  seed: number;
  rngState: number;
  game: GameState | null; // null in the lobby
  createdAt: number;
  lastActivityAt: number;
}
```

A seat `id` is the engine `playerId`. `startRound` receives
`seats.map((s) => ({ id: s.id, name: s.name }))`.

## Server-authoritative action flow

The `game:action` handler:

1. zod-parse the payload to `{ action: GameAction }`.
2. Resolve the socket's room and seat. Reject spectators with `not-a-player`.
3. Check the actor id on the action (`playerId`, or `accuserId` /
   `challengerId` for the catch and challenge actions) equals the sender's seat
   id. Reject `wrong-actor` otherwise.
4. Rebuild the RNG from `{ seed, rngState }`. Run `applyAction(room.game, action,
{ rng })`.
5. On `ok: false`, reply to the caller's ack only. Broadcast nothing.
6. On `ok: true`: replace `room.game`, save `rng.state` into `room.rngState`,
   bump `lastActivityAt`. Emit `game:delta` to every connected participant, each
   with their own redacted view plus the `GameEvent[]`. If the round or match
   ended, also emit `game:roundEnded` or `game:matchEnded`. Reset the turn timer.
7. Ack the caller `{ ok: true }`.

A client can emit any action it likes. Step 3 stops it acting as another player;
the engine rejects everything else that is not legal.

## Redacted views

The server never sends a full `GameState` to a client.

```ts
interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  connected: boolean;
  calledUno: boolean;
}

interface BoardView {
  discardTop: Card;
  activeColor: CardColor | null;
  direction: 1 | -1;
  currentSeatId: string;
  pendingDraw: number;
  pendingDrawKind: PendingDrawKind | null;
  awaitingColorChoiceFrom: string | null;
  scores: Record<string, number>;
  phase: RoomPhase;
  status: GameStatus;
}

interface PlayerView {
  self: { id: string; hand: Card[]; hasCalledUno: boolean };
  players: PublicPlayer[];
  board: BoardView;
}

interface SpectatorView {
  players: PublicPlayer[];
  board: BoardView;
}
```

A `redact` unit test asserts that no other player's hand contents ever appear in
a `PlayerView` or `SpectatorView`.

## Events

### Client to server (each zod-validated, each with an ack)

| Event                 | Payload                                    | Ack                                                    |
| --------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `room:create`         | `{ name, houseRules?, turnTimerSeconds? }` | `{ code, playerToken, view }`                          |
| `room:join`           | `{ code, name }`                           | `{ playerToken, view }` or `{ spectator: true, view }` |
| `room:reconnect`      | `{ code, playerToken }`                    | `{ view }`                                             |
| `room:leave`          | `{}`                                       | `{ ok }`                                               |
| `room:updateSettings` | `{ houseRules, turnTimerSeconds }`         | `{ ok }` (host, lobby only)                            |
| `room:start`          | `{}`                                       | `{ ok }` (host only)                                   |
| `game:action`         | `{ action }`                               | `{ ok: true }` or `{ ok: false, code }`                |

### Server to client

| Event                                   | Payload                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `room:snapshot`                         | `{ view, room: RoomSummary }`                        |
| `room:presence`                         | `{ seatId, connected }`                              |
| `room:playerJoined` / `room:playerLeft` | `{ seatId, name }`                                   |
| `room:settingsChanged`                  | `{ houseRules, turnTimerSeconds }`                   |
| `game:started`                          | `{ view }`                                           |
| `game:delta`                            | `{ view, events: GameEvent[], autoPlayed?: string }` |
| `game:roundEnded`                       | `{ winnerId, scores }`                               |
| `game:matchEnded`                       | `{ winnerId, scores }`                               |
| `turn:timer`                            | `{ seatId, endsAt }`                                 |
| `error`                                 | `{ code, message }`                                  |

## Reconnect

- On create and join the server issues a `playerToken`: 32 random bytes,
  base64url, mapped server-side to `{ code, seatId }`. The client stores it
  (localStorage, in the client milestone).
- On socket disconnect: `seat.connected = false`, `seat.disconnectedAt = now`,
  broadcast `room:presence`. The seat stays. If it was that seat's turn, the turn
  timer keeps running.
- `room:reconnect { code, playerToken }`: resolve the token to a seat, bind the
  new socket, `seat.connected = true`, send `room:snapshot`, broadcast presence.
- A seat left disconnected past a grace period is dropped only while the room is
  in the lobby. During an active game the seat is kept indefinitely and
  auto-played each turn, so the game stays valid for everyone else.

## Turn timer

- Per room. Default 45 seconds. `null` disables it.
- Rescheduled on every turn change to `now + turnTimerSeconds`.
- On expiry the server plays the current seat's move through the same action
  path: `draw`, then `pass` if the drawn card is not playable; `draw` alone if
  the seat is facing a pending draw stack. The resulting `game:delta` carries
  `autoPlayed: seatId`.
- `turn:timer { seatId, endsAt }` lets clients render a countdown.

## Security

- `helmet()` on the Express app.
- CORS pinned to `config.CORS_ORIGIN` (comma-separated list) for both Express and
  the Socket.IO server. Never `*`.
- Every socket payload parsed with a zod schema at the handler boundary. A parse
  failure emits `error` and changes no state.
- Token-bucket rate limits per IP: `room:create` at 5 per minute,
  `room:reconnect` at 10 per minute, `game:action` a loose burst cap.
- Player names: trimmed, 2 to 20 characters, control characters stripped. Stored
  raw within those bounds. Render-time escaping is the client's job.
- Config from environment only. `config.ts` parses it with zod and fails fast.
- Graceful shutdown on SIGTERM: stop accepting connections, close Socket.IO,
  flush the logger, exit.

## Server layout

```
apps/server/src/
  main.ts               bootstrap and graceful shutdown
  config.ts             zod-parsed env
  logger.ts             pino
  http/app.ts           express: helmet, cors, GET /health, GET /rooms/:code
  rooms/
    codes.ts            room code generation, no-lookalike alphabet
    room.ts             Room type and pure transition helpers
    store.ts            RoomStore interface
    memory-store.ts     InMemoryRoomStore with a dead-room sweep
    tokens.ts           playerToken issue, resolve, revoke
  game/
    session.ts          the action flow above
    redact.ts           toPlayerView, toSpectatorView, toRoomSummary
  socket/
    index.ts            attach(io): per-connection context and handler wiring
    handlers.ts         one handler per client event, zod at the boundary
    rate-limit.ts       token bucket keyed by ip
    presence.ts         connect and disconnect bookkeeping
  turns/timer.ts        per-room turn timer
  errors.ts             ProtocolError codes
```

## Testing

- **Unit** (Vitest): `codes` format and collision handling, `redact` leak check,
  `room` transition helpers, `tokens`, `rate-limit` bucket refill.
- **Integration** (Vitest with real `socket.io-client` against a server on an
  ephemeral port):
  - two clients: create, join, start, play a full round to a win, each asserting
    it only ever receives its own hand
  - reconnect: client B drops, client A plays a turn, B reconnects with its
    token and receives the current state
  - spectator: a third client joins a started room, receives spectator views,
    gets `wrong-actor` or `not-a-player` on `game:action`
  - turn timer: a 1-second timer expires and the server auto-plays the seat
  - an illegal `game:action` is rejected on the ack and broadcasts nothing
- Coverage gate at 100 percent for `packages/contracts` and for `apps/server`
  excluding `main.ts`, which the integration tests exercise end to end but not
  line by line.

## Commit plan

Branch `feat/realtime-layer`, merged to `main` through a pull request. Tag
`v0.2.0` once the integration tests are green.

1. `feat(engine): make the rng resumable from saved state`
2. `chore(contracts): scaffold the shared wire-contract package`
3. `feat(contracts): define socket event maps and payload schemas`
4. `feat(contracts): add redacted player and spectator views`
5. `chore(server): scaffold the express and socket.io app`
6. `feat(server): parse config from the environment`
7. `feat(server): add structured logging`
8. `feat(server): health check and security headers`
9. `feat(server): room model and in-memory store`
10. `feat(server): room codes and player tokens`
11. `feat(server): create, join, and leave rooms`
12. `feat(server): redacted views and the game action loop`
13. `feat(server): start rounds and broadcast deltas`
14. `feat(server): reconnect to a seat with a player token`
15. `feat(server): presence tracking and disconnect handling`
16. `feat(server): per-room turn timer with auto-play`
17. `feat(server): rate limit room creation and reconnects`
18. `feat(server): graceful shutdown`
19. `test(server): full-game, reconnect, and spectator integration tests`
20. `ci: lint, typecheck, and test the new packages`
