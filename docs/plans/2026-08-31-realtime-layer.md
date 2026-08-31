# Realtime layer implementation plan

**Goal:** A Socket.IO server that runs UNO games on the tested engine, with rooms, server-authoritative validation, redacted per-player state, reconnect, presence, and a turn timer.

**Architecture:** Two new workspace members. `packages/contracts` holds the zod schemas, the typed Socket.IO event maps, and the redacted view shapes. `apps/server` composes an Express app and a Socket.IO server around an in-memory room store, behind a `RoomStore` interface so Redis is a later swap. A single `session.applyPlayerAction` function is the only path that mutates a game: it checks the sender is the actor, runs the engine, saves the RNG position, and broadcasts one redacted delta per participant.

**Tech stack:** Express, Socket.IO, zod, pino, helmet, Vitest, socket.io-client for integration tests.

**Reference:** [docs/specs/2026-08-31-realtime-layer-design.md](../specs/2026-08-31-realtime-layer-design.md)

Branch `feat/realtime-layer`, merged to `main` through a pull request. Tag `v0.2.0`
once the integration suite is green. TDD throughout: test, watch it fail,
implement, watch it pass, commit.

---

## Task 1: resumable engine RNG

**Files:**

- Modify: `packages/engine/src/rng.ts`, `packages/engine/src/rng.test.ts`
- Modify: `packages/engine/src/index.ts` (already exports `createRng`, `Rng`; no change needed unless a type moves)

**Behaviors to test:**

- [ ] `createRng(seed)` unchanged: same seed, same sequence.
- [ ] `rng.state` returns a number and changes after `next()`.
- [ ] `createRng(seed, savedState)` resumes: take a fresh `createRng(1)`, call `next()` three times, read `state`, build `createRng(1, state)`, and its next 5 values equal the original's next 5 values.
- [ ] `createRng(seed)` with no state starts from `seed >>> 0` as before.

**Steps:**

- [ ] Write the tests above.
- [ ] Change `createRng` signature to `createRng(seed: number, state?: number): Rng`. Internal `state` starts at `state ?? (seed >>> 0)`. Add a `get state()` returning the current internal value to the returned object.
- [ ] Run `pnpm --filter @uno/engine test`, expect green with 100% coverage still.
- [ ] Commit: `feat(engine): make the rng resumable from saved state`

---

## Task 2: contracts package skeleton

**Files:**

- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/tsconfig.build.json`, `packages/contracts/vitest.config.ts`, `packages/contracts/src/index.ts`, `packages/contracts/README.md`

**Steps:**

- [ ] `package.json`: name `@uno/contracts`, type module, `main`/`types` to `dist`, `exports` map. Scripts `test` (`vitest run --coverage`), `test:watch`, `typecheck` (`tsc --noEmit`), `build` (`tsc -p tsconfig.build.json`). Dependencies: `zod`, `@uno/engine` (`workspace:*`). Dev: `vitest`, `@vitest/coverage-v8`.
- [ ] `tsconfig.json` extends `../../tsconfig.base.json`, includes `src` and `vitest.config.ts`. `tsconfig.build.json` sets `rootDir: src`, `outDir: dist`, `declaration`, excludes `**/*.test.ts`.
- [ ] `vitest.config.ts`: v8 coverage, `all: true`, include `src/**/*.ts`, exclude `src/index.ts` and `**/*.test.ts`, thresholds 100.
- [ ] Install: `pnpm install`.
- [ ] `src/index.ts` re-exports from the modules added in tasks 3 and 4 (start empty, `export {}`).
- [ ] Verify `pnpm --filter @uno/contracts typecheck` passes.
- [ ] Commit: `chore(contracts): scaffold the shared wire-contract package`

---

## Task 3: payload schemas

**Files:**

- Create: `packages/contracts/src/schemas.ts`, `packages/contracts/src/schemas.test.ts`

**What to build:**

```ts
export const displayNameSchema = z
  .string()
  .transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
  .pipe(z.string().min(2).max(20));

export const roomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);

export const cardColorSchema = z.enum(['red', 'yellow', 'green', 'blue']);

export const houseRulesSchema = z.object({
  stacking: z.enum(['off', 'draw-two', 'draw-four', 'both']),
  drawUntilPlayable: z.boolean(),
  playDrawnCard: z.boolean(),
  jumpIn: z.boolean(),
  unoPenalty: z.number().int().min(1).max(10),
  wildFourChallenge: z.boolean(),
  targetScore: z.number().int().min(100).max(1000),
  firstCardRule: z.enum(['official', 'simple']),
});

export const gameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('play-card'),
    playerId: z.string(),
    cardId: z.string(),
    chosenColor: cardColorSchema.optional(),
  }),
  z.object({
    type: z.literal('play-drawn'),
    playerId: z.string(),
    cardId: z.string(),
    chosenColor: cardColorSchema.optional(),
  }),
  z.object({ type: z.literal('draw'), playerId: z.string() }),
  z.object({ type: z.literal('pass'), playerId: z.string() }),
  z.object({ type: z.literal('choose-color'), playerId: z.string(), color: cardColorSchema }),
  z.object({ type: z.literal('call-uno'), playerId: z.string() }),
  z.object({ type: z.literal('catch-unfair-uno'), accuserId: z.string(), targetId: z.string() }),
  z.object({ type: z.literal('challenge-wild-four'), challengerId: z.string() }),
]);

export const turnTimerSchema = z.number().int().min(10).max(300).nullable();

export const roomCreateSchema = z.object({
  name: displayNameSchema,
  houseRules: houseRulesSchema.partial().optional(),
  turnTimerSeconds: turnTimerSchema.optional(),
});
export const roomJoinSchema = z.object({ name: displayNameSchema, code: roomCodeSchema });
export const roomReconnectSchema = z.object({
  code: roomCodeSchema,
  playerToken: z.string().min(20).max(100),
});
export const roomUpdateSettingsSchema = z.object({
  houseRules: houseRulesSchema,
  turnTimerSeconds: turnTimerSchema,
});
export const gameActionMessageSchema = z.object({ action: gameActionSchema });
```

**Behaviors to test:**

- [ ] `displayNameSchema` strips control characters, trims, then enforces 2 to 20; rejects `"a"`, accepts `"  Ada  "` as `"Ada"`, strips a `"�"`.
- [ ] `roomCodeSchema` rejects lowercase, rejects `"AAAAA1"` (contains `1`), rejects 5 or 7 chars, accepts `"ABCJK2"`.
- [ ] `gameActionSchema` parses each of the 8 action shapes; rejects `{ type: 'play-card' }` with no `cardId`; rejects `{ type: 'nonsense' }`.
- [ ] Every field name in `gameActionSchema` matches the engine's `GameAction` union exactly. Add a type-level assertion: `const _check: GameAction = {} as z.infer<typeof gameActionSchema>` should not need a cast (write it as an exported `satisfies` check in a `types.ts` or inline in the test).
- [ ] `houseRulesSchema` output is assignable to the engine `HouseRules`.
- [ ] `turnTimerSchema` accepts `null`, `45`; rejects `5`, `500`, `12.5`.

**Steps:** test, implement, run, commit.

- [ ] Commit: `feat(contracts): add payload schemas for every socket message`

---

## Task 4: event maps and redacted views

**Files:**

- Create: `packages/contracts/src/views.ts`, `packages/contracts/src/events.ts`, `packages/contracts/src/errors.ts`, `packages/contracts/src/views.test.ts`
- Modify: `packages/contracts/src/index.ts` to export everything

**`views.ts`:**

```ts
export type RoomPhase = 'lobby' | 'active' | 'finished';

export interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  connected: boolean;
  calledUno: boolean;
}

export interface BoardView {
  discardTop: Card;
  activeColor: CardColor | null;
  direction: 1 | -1;
  currentSeatId: string;
  pendingDraw: number;
  pendingDrawKind: PendingDrawKind | null;
  awaitingColorChoiceFrom: string | null;
  scores: Record<string, number>;
  status: GameStatus;
  roundWinnerId: string | null;
}

export interface PlayerView {
  kind: 'player';
  self: { id: string; hand: Card[]; hasCalledUno: boolean };
  players: PublicPlayer[];
  board: BoardView | null; // null in the lobby
}

export interface SpectatorView {
  kind: 'spectator';
  players: PublicPlayer[];
  board: BoardView | null;
}

export interface RoomSummary {
  code: string;
  phase: RoomPhase;
  hostSeatId: string;
  seatCount: number;
  spectatorCount: number;
  houseRules: HouseRules;
  turnTimerSeconds: number | null;
}
```

**`errors.ts`:** a `ProtocolErrorCode` union:
`'room-not-found' | 'room-full' | 'not-host' | 'already-started' | 'not-in-lobby' | 'invalid-payload' | 'not-a-player' | 'wrong-actor' | 'rate-limited' | 'bad-token' | 'too-few-players' | 'name-required'`
plus `interface ProtocolError { code: ProtocolErrorCode; message: string }`.

**`events.ts`:** Socket.IO typed maps.

```ts
export interface ClientToServerEvents {
  'room:create': (
    p: RoomCreate,
    ack: (r: Result<{ code: string; playerToken: string; view: PlayerView }>) => void,
  ) => void;
  'room:join': (
    p: RoomJoin,
    ack: (
      r: Result<
        { playerToken: string; view: PlayerView } | { spectator: true; view: SpectatorView }
      >,
    ) => void,
  ) => void;
  'room:reconnect': (
    p: RoomReconnect,
    ack: (r: Result<{ view: PlayerView | SpectatorView }>) => void,
  ) => void;
  'room:leave': (ack: (r: Result<Record<string, never>>) => void) => void;
  'room:updateSettings': (
    p: RoomUpdateSettings,
    ack: (r: Result<Record<string, never>>) => void,
  ) => void;
  'room:start': (ack: (r: Result<Record<string, never>>) => void) => void;
  'game:action': (p: GameActionMessage, ack: (r: Result<Record<string, never>>) => void) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (p: { view: PlayerView | SpectatorView; room: RoomSummary }) => void;
  'room:presence': (p: { seatId: string; connected: boolean }) => void;
  'room:playerJoined': (p: { seatId: string; name: string }) => void;
  'room:playerLeft': (p: { seatId: string; name: string }) => void;
  'room:settingsChanged': (p: { room: RoomSummary }) => void;
  'game:started': (p: { view: PlayerView | SpectatorView }) => void;
  'game:delta': (p: {
    view: PlayerView | SpectatorView;
    events: GameEvent[];
    autoPlayed?: string;
  }) => void;
  'game:roundEnded': (p: { winnerId: string; scores: Record<string, number> }) => void;
  'game:matchEnded': (p: { winnerId: string; scores: Record<string, number> }) => void;
  'turn:timer': (p: { seatId: string; endsAt: number }) => void;
  error: (p: ProtocolError) => void;
}

export interface SocketData {
  code: string | null;
  seatId: string | null;
  spectatorId: string | null;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ProtocolError };
```

**Behaviors to test (`views.test.ts` covers the view types only once redact exists; for now):**

- [ ] `index.ts` re-exports every public name; a smoke test imports `PlayerView`, `gameActionSchema`, `ClientToServerEvents` type and `ProtocolError`.
- [ ] Type assertion: `z.infer<typeof houseRulesSchema>` equals engine `HouseRules` (write `const _: HouseRules = {} as z.infer<...>` and the reverse).

**Steps:** implement, typecheck, small smoke test, commit.

- [ ] Commit: `feat(contracts): add event maps, views, and protocol errors`

---

## Task 5: server package skeleton

**Files:**

- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/tsconfig.build.json`, `apps/server/vitest.config.ts`, `apps/server/src/main.ts` (stub), `apps/server/README.md`, `apps/server/.dockerignore`

**Steps:**

- [ ] `package.json`: name `@uno/server`, private, type module. Scripts: `dev` (`tsx watch src/main.ts`), `start` (`node dist/main.js`), `build` (`tsc -p tsconfig.build.json`), `typecheck` (`tsc --noEmit`), `test` (`vitest run --coverage`), `test:watch`. Dependencies: `express`, `socket.io`, `helmet`, `cors`, `pino`, `pino-http`, `zod`, `@uno/engine` (`workspace:*`), `@uno/contracts` (`workspace:*`). Dev: `vitest`, `@vitest/coverage-v8`, `socket.io-client`, `tsx`, `@types/express`, `@types/cors`.
- [ ] `tsconfig.json` extends base, includes `src` and `vitest.config.ts`. `tsconfig.build.json`: `rootDir: src`, `outDir: dist`, excludes `**/*.test.ts` and `**/__tests__/**`.
- [ ] `vitest.config.ts`: v8 coverage, `all: true`, include `src/**/*.ts`, exclude `src/main.ts`, `**/*.test.ts`, `src/**/__tests__/**`. Thresholds 100 for branches/functions/lines/statements.
- [ ] `src/main.ts` stub: `console`-free, just `export {}` for now (filled in Task 18).
- [ ] `pnpm install`. Verify `pnpm --filter @uno/server typecheck`.
- [ ] Commit: `chore(server): scaffold the express and socket.io app`

---

## Task 6: config and logger

**Files:**

- Create: `apps/server/src/config.ts`, `apps/server/src/config.test.ts`, `apps/server/src/logger.ts`

**`config.ts`:**

```ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config;
```

`corsOrigins` is `CORS_ORIGIN` split on `,` and trimmed. `loadConfig` throws a
readable error listing every invalid field when parsing fails.

**Behaviors to test:**

- [ ] Defaults apply when the env is empty.
- [ ] `PORT="8080"` coerces to the number `8080`.
- [ ] `CORS_ORIGIN="https://a.com, https://b.com"` becomes `['https://a.com', 'https://b.com']`.
- [ ] `PORT="banana"` throws, and the message names `PORT`.
- [ ] `LOG_LEVEL="loud"` throws.

**`logger.ts`:** `createLogger(config: Config)` returns a pino instance at
`config.logLevel`, pretty transport only when `nodeEnv === 'development'`. No test
needed beyond it constructing; exclude from coverage if it is a one-liner, or add
a trivial test that `createLogger(cfg).level === cfg.logLevel`.

- [ ] Commit: `feat(server): parse config from the environment`
- [ ] Commit: `feat(server): add a structured logger`

---

## Task 7: room codes and player tokens

**Files:**

- Create: `apps/server/src/rooms/codes.ts`, `apps/server/src/rooms/codes.test.ts`
- Create: `apps/server/src/rooms/tokens.ts`, `apps/server/src/rooms/tokens.test.ts`

**`codes.ts`:**

```ts
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
export function generateRoomCode(rng: () => number = Math.random): string; // 6 chars
export function isTaken(code: string, exists: (code: string) => boolean): boolean;
export function uniqueRoomCode(exists: (code: string) => boolean, rng?: () => number): string; // retries on collision, throws after 50 tries
```

**Behaviors to test:**

- [ ] `generateRoomCode` returns 6 characters, all from the alphabet.
- [ ] It never contains `I`, `O`, `0`, or `1` over 1000 draws.
- [ ] `uniqueRoomCode` returns a code that `exists` reports as free.
- [ ] `uniqueRoomCode` retries when the first codes collide (feed an `exists` that returns true for the first two generated codes, using a seeded rng).
- [ ] `uniqueRoomCode` throws after 50 straight collisions.

**`tokens.ts`:**

```ts
export interface TokenRegistry {
  issue(code: string, seatId: string): string;
  resolve(token: string): { code: string; seatId: string } | undefined;
  revokeRoom(code: string): void;
}
export function createTokenRegistry(): TokenRegistry;
```

Tokens are `randomBytes(32).toString('base64url')`.

**Behaviors to test:**

- [ ] `issue` then `resolve` returns the same `{ code, seatId }`.
- [ ] `resolve` of an unknown token is `undefined`.
- [ ] Two `issue` calls return different tokens.
- [ ] `revokeRoom` makes every token for that code stop resolving, leaves others intact.

- [ ] Commit: `feat(server): room codes and player tokens`

---

## Task 8: the room model

**Files:**

- Create: `apps/server/src/rooms/room.ts`, `apps/server/src/rooms/room.test.ts`

**Types:** `Seat`, `Spectator`, `Room`, `RoomPhase` as in the spec. Seat ids and
spectator ids are `randomUUID()`.

**Pure functions (no store, no sockets):**

```ts
export function createRoom(input: {
  code: string;
  host: { name: string };
  houseRules: HouseRules;
  turnTimerSeconds: number | null;
  seed: number;
  now: number;
}): Room; // one seat (the host), phase 'lobby', rngState = seed >>> 0

export function addSeat(
  room: Room,
  name: string,
  now: number,
): { room: Room; seat: Seat } | { full: true };
// max 10 seats, only in phase 'lobby'; a joiner after 'active' is a spectator (caller handles that)

export function addSpectator(room: Room, name: string): { room: Room; spectator: Spectator };

export function markSeatConnected(
  room: Room,
  seatId: string,
  connected: boolean,
  now: number,
): Room;

export function removeSeat(room: Room, seatId: string): Room; // reassigns host if the host left and seats remain

export function canStart(
  room: Room,
): { ok: true } | { ok: false; code: 'not-in-lobby' | 'too-few-players' };

export function seatBySocketOwnership(room: Room, seatId: string): Seat | undefined;
```

All return new `Room` objects (spread), no mutation, so the store layer decides
persistence.

**Behaviors to test:**

- [ ] `createRoom` gives one seat, host is that seat, phase `lobby`, `rngState === seed >>> 0`.
- [ ] `addSeat` up to 10 works; the 11th returns `{ full: true }`.
- [ ] `addSeat` on an `active` room is rejected (returns `{ full: true }` is wrong here; return a distinct signal). Decide: `addSeat` only for lobby, returns `{ closed: true }` when not lobby. Update the type. Test both `full` and `closed`.
- [ ] `markSeatConnected` flips the flag and sets or clears `disconnectedAt`.
- [ ] `removeSeat` for a non-host leaves host unchanged; removing the host promotes the next seat; removing the last seat leaves `seats: []`.
- [ ] `canStart` needs phase `lobby` and at least 2 seats.

- [ ] Commit: `feat(server): the room model and its transitions`

---

## Task 9: room store

**Files:**

- Create: `apps/server/src/rooms/store.ts`, `apps/server/src/rooms/memory-store.ts`, `apps/server/src/rooms/memory-store.test.ts`

**`store.ts`:**

```ts
export interface RoomStore {
  create(room: Room): void;
  get(code: string): Room | undefined;
  save(room: Room): void; // replace by code
  delete(code: string): void;
  list(): Room[];
  sweep(now: number, maxIdleMs: number): string[]; // delete idle rooms, return their codes
}
```

**`memory-store.ts`:** a `Map<string, Room>`. `get` returns a structuredClone so
callers cannot mutate the stored copy by accident (matches how a Redis store
would behave, and the integration tests will catch it if we skip this). `save`
replaces. `sweep` removes rooms whose `lastActivityAt` is older than
`now - maxIdleMs` and returns the removed codes.

**Behaviors to test:**

- [ ] `create` then `get` returns an equal but not identical room (`toEqual`, `not.toBe`).
- [ ] Mutating the object returned by `get` does not change what a later `get` returns.
- [ ] `save` overwrites.
- [ ] `delete` removes; `get` is then `undefined`.
- [ ] `sweep` deletes only the rooms past the idle cutoff and returns their codes.

- [ ] Commit: `feat(server): in-memory room store behind a swappable interface`

---

## Task 10: redacted views

**Files:**

- Create: `apps/server/src/game/redact.ts`, `apps/server/src/game/redact.test.ts`

**Functions:**

```ts
export function toRoomSummary(room: Room): RoomSummary;
export function toPublicPlayers(room: Room): PublicPlayer[]; // from seats + game state
export function toBoardView(room: Room): BoardView | null; // null when room.game is null
export function toPlayerView(room: Room, seatId: string): PlayerView;
export function toSpectatorView(room: Room): SpectatorView;
```

`toPublicPlayers` pulls `handCount` and `calledUno` from `room.game` when active,
and `handCount: 0`, `calledUno: false` in the lobby. `connected` comes from the
seat.

**Behaviors to test:**

- [ ] `toPlayerView` includes the caller's full hand and every opponent only as counts. Build an active room with known hands and assert no opponent card `id` appears anywhere in `JSON.stringify(view.players)` or `view.board`.
- [ ] `toSpectatorView` contains no `hand` array at all; assert the same no-card-id property across the whole view.
- [ ] `toBoardView` maps `currentPlayerIndex` to the seat id, copies `activeColor`, `pendingDraw`, `direction`, `scores`, `status`.
- [ ] `toBoardView` is `null` for a lobby room; `toPlayerView` then has `board: null` and `self.hand: []`.
- [ ] `toRoomSummary` counts seats and spectators and copies the settings.

- [ ] Commit: `feat(server): redacted player and spectator views`

---

## Task 11: the game session

**Files:**

- Create: `apps/server/src/game/session.ts`, `apps/server/src/game/session.test.ts`
- Create: `apps/server/src/errors.ts` (re-export `ProtocolError`, add a `protocolError(code, message)` helper)

**Functions:**

```ts
export function startGame(room: Room, now: number): { room: Room } | { error: ProtocolError };
// canStart check, engine startRound with createRng(room.seed, room.rngState), save rngState, phase 'active'

export interface ActionOutcome {
  room: Room;
  events: GameEvent[];
  roundEnded: { winnerId: string; scores: Record<string, number> } | null;
  matchEnded: { winnerId: string; scores: Record<string, number> } | null;
}

export function applyPlayerAction(
  room: Room,
  seatId: string,
  action: GameAction,
  now: number,
): ActionOutcome | { error: ProtocolError };
// 1. room.game must be non-null and status 'active', else error 'not-in-lobby' / a new 'no-active-round'
// 2. actor id on the action must equal seatId ('wrong-actor')
// 3. rebuild rng from room.seed + room.rngState
// 4. applyAction; on ok:false map GameError.code into a ProtocolError-ish passthrough (keep the engine code string)
// 5. on ok: save game + rngState + lastActivityAt; derive roundEnded / matchEnded from result.events
```

Add a `ProtocolErrorCode` member `'illegal-move'` that carries the engine's code
in `message`, or widen the ack error to allow engine codes. Decide: the
`game:action` ack error is `{ code: string; message: string }` where `code` is
either a `ProtocolErrorCode` or a `GameErrorCode`. Document this in `errors.ts`.

**Behaviors to test:**

- [ ] `startGame` on a 2-seat lobby room moves it to `active`, deals hands, sets `rngState` to something other than the seed.
- [ ] `startGame` on a 1-seat room returns `too-few-players`.
- [ ] `startGame` twice returns an error the second time.
- [ ] `applyPlayerAction` with `action.playerId !== seatId` returns `wrong-actor`, room unchanged.
- [ ] A legal `draw` returns an `ActionOutcome` with the new room, a `player-drew` event, `roundEnded: null`.
- [ ] An illegal move (play a card not in hand) returns `{ error }` with the engine code, room unchanged.
- [ ] Playing a last card sets `roundEnded` with the winner and scores; `matchEnded` stays null below the target.
- [ ] Two `applyPlayerAction` calls in a row advance `rngState` deterministically: same starting room and same actions from a fixed seed produce the same resulting hands.
- [ ] `catch-unfair-uno`: `seatId` must equal `accuserId`; `challenge-wild-four`: `seatId` must equal `challengerId`.

- [ ] Commit: `feat(server): the server-authoritative game session`

---

## Task 12: rate limiter

**Files:**

- Create: `apps/server/src/socket/rate-limit.ts`, `apps/server/src/socket/rate-limit.test.ts`

**`rate-limit.ts`:**

```ts
export interface RateLimiter {
  tryConsume(key: string, now: number): boolean;
}
export function createRateLimiter(opts: { capacity: number; refillPerSecond: number }): RateLimiter;
```

Token bucket keyed by string (an IP). Full at `capacity`, refills continuously.

**Behaviors to test:**

- [ ] `capacity` consecutive calls at the same `now` succeed, the next fails.
- [ ] After enough elapsed `now` the bucket refills by the right amount.
- [ ] The bucket never exceeds `capacity` no matter how long it idles.
- [ ] Different keys have independent buckets.

- [ ] Commit: `feat(server): a token-bucket rate limiter`

---

## Task 13: the HTTP app

**Files:**

- Create: `apps/server/src/http/app.ts`, `apps/server/src/http/app.test.ts`

**`app.ts`:**

```ts
export function createHttpApp(deps: {
  store: RoomStore;
  config: Config;
  logger: Logger;
}): express.Express;
```

- `helmet()`
- `cors({ origin: config.corsOrigins })`
- `express.json({ limit: '16kb' })`
- `pino-http` with the logger
- `GET /health` -> `{ status: 'ok', uptime, rooms: store.list().length }`
- `GET /rooms/:code` -> `toRoomSummary` for an existing room, 404 `{ error: 'room-not-found' }` otherwise. Only the summary, never seats' hands.

**Behaviors to test (supertest or `app.listen(0)` + fetch):**

- [ ] `GET /health` returns 200 and `status: 'ok'`.
- [ ] `GET /rooms/UNKNOWN` returns 404 with `error: 'room-not-found'`.
- [ ] `GET /rooms/:code` for a seeded room returns its summary and no `hand` field anywhere in the body.
- [ ] A cross-origin request from an origin not in `corsOrigins` does not get an allow-origin header; one from an allowed origin does.
- [ ] `helmet` headers are present (`x-content-type-options: nosniff`).

- [ ] Commit: `feat(server): health check, room summary endpoint, and security headers`

---

## Task 14: socket wiring and the room lifecycle handlers

**Files:**

- Create: `apps/server/src/socket/context.ts`, `apps/server/src/socket/index.ts`, `apps/server/src/socket/handlers/rooms.ts`
- Create: `apps/server/src/socket/__tests__/rooms.test.ts` (integration, real client)
- Create: `apps/server/src/testing/harness.ts` (excluded from build and coverage): `startTestServer()` returns `{ url, close }`, `connect(url)` returns a typed `socket.io-client` socket, `emitAck(socket, event, payload)` promisified.

**`context.ts`:** a `HandlerContext` object passed to every handler:
`{ io, socket, store, tokens, logger, config, rateLimiters: { create, reconnect }, timers: TurnTimers }`. Also helpers `roomOf(socket)`, `seatOf(socket, room)`, `emitError(socket, code, message)`, `broadcastRoom(room, event, payload)` (to the Socket.IO room named by `code`), `snapshotEveryone(room)`.

**`handlers/rooms.ts`:** `room:create`, `room:join`, `room:leave`.

- `room:create`: rate-limit by IP; parse `roomCreateSchema`; build config-merged house rules; `uniqueRoomCode`; `createRoom`; `store.create`; `tokens.issue`; `socket.join(code)`; set `socket.data`; ack `{ code, playerToken, view: toPlayerView }`.
- `room:join`: parse `roomJoinSchema`; `store.get`; if missing -> ack error `room-not-found`; if phase `lobby` and seats < 10 -> `addSeat`, issue token, join, ack player view, broadcast `room:playerJoined` and a fresh snapshot to others; if phase not lobby or full -> `addSpectator`, join, ack `{ spectator: true, view: toSpectatorView }`.
- `room:leave`: if seated in lobby -> `removeSeat`, revoke that seat's token is not possible per-seat (registry is per room); leave that; if seated mid-game -> keep the seat, just mark disconnected via the disconnect path; if spectator -> drop from spectators. `socket.leave(code)`, clear `socket.data`, broadcast.

**Integration behaviors to test:**

- [ ] create then join: the joiner's ack view lists two players; the creator receives `room:playerJoined`.
- [ ] join a missing code: ack `{ ok: false, error: { code: 'room-not-found' } }`.
- [ ] an 11th joiner to a lobby becomes a spectator (fill 10 first, or lower the cap in a helper... keep 10, loop).
- [ ] join a room whose game has started: ack has `spectator: true` and a `SpectatorView`.
- [ ] `room:create` past the rate limit in a tight loop: the 6th within a minute acks `rate-limited`.
- [ ] `room:leave` in the lobby removes the seat and the others get a snapshot without that player.

- [ ] Commit: `feat(server): create, join, and leave rooms over sockets`

---

## Task 15: start, settings, and the action loop

**Files:**

- Create: `apps/server/src/socket/handlers/game.ts`
- Modify: `apps/server/src/socket/index.ts` to register them
- Create: `apps/server/src/socket/__tests__/game.test.ts` (integration)

**Handlers:** `room:updateSettings`, `room:start`, `game:action`.

- `room:updateSettings`: seat must be host, phase must be `lobby`; parse `roomUpdateSettingsSchema`; save; broadcast `room:settingsChanged`.
- `room:start`: seat must be host; `startGame`; save; broadcast `game:started` with each participant's own view; start the turn timer (Task 16).
- `game:action`: parse `gameActionMessageSchema`; resolve room and seat (`not-a-player` for spectators); `applyPlayerAction(room, seatId, action, now)`; on `{ error }` ack `{ ok: false, error }` and stop; on `ActionOutcome` save the room, ack `{ ok: true }`, emit `game:delta` to every connected participant with their own view, then `game:roundEnded` / `game:matchEnded` if set, then reschedule the turn timer.

Add `snapshotEveryone` / `deltaEveryone(room, events, autoPlayed?)` to the context
helpers: iterate seats and spectators, look up each one's socket in the Socket.IO
room, emit its tailored payload.

**Integration behaviors to test:**

- [ ] Non-host `room:start` acks `not-host`.
- [ ] Host `room:start` on a 2-seat room: both clients get `game:started`, each sees 7 cards in `self.hand` and the opponent as `handCount: 7`.
- [ ] Full round: script both clients through to a win using each client's own view to choose a legal move (reuse the engine's `canPlayOn`); assert the loser receives `game:roundEnded` with the right winner, and at no point did a client receive an opponent's card id.
- [ ] A spectator emitting `game:action` acks `not-a-player`.
- [ ] A client emitting `game:action` with someone else's `playerId` acks `wrong-actor`.
- [ ] An illegal move acks `{ ok: false, error: { code: 'card-not-in-hand' } }` and no `game:delta` is emitted to anyone (assert with a spy that no delta arrives within 100ms).
- [ ] `room:updateSettings` by the host changes `turnTimerSeconds`; a non-host attempt acks `not-host`.

- [ ] Commit: `feat(server): start rounds, change settings, and run the action loop`

---

## Task 16: presence and reconnect

**Files:**

- Create: `apps/server/src/socket/handlers/reconnect.ts`, `apps/server/src/socket/presence.ts`
- Modify: `apps/server/src/socket/index.ts` (register `room:reconnect`, wire `disconnect`)
- Create: `apps/server/src/socket/__tests__/reconnect.test.ts` (integration)

**`presence.ts`:** `onDisconnect(ctx)`: find the room and seat from `socket.data`;
if seated, `markSeatConnected(room, seatId, false, now)`, save, broadcast
`room:presence { seatId, connected: false }`. If spectator, remove and broadcast
`room:playerLeft`. Never delete a seat here.

**`handlers/reconnect.ts`:** `room:reconnect`: rate-limit by IP; parse
`roomReconnectSchema`; `tokens.resolve` -> `{ code, seatId }` or ack `bad-token`;
`store.get(code)` or ack `room-not-found`; confirm the seat still exists;
`socket.join(code)`, set `socket.data`, `markSeatConnected(..., true, now)`, save;
ack `{ view }` (player or spectator view for that seat); broadcast
`room:presence { connected: true }`.

**Integration behaviors to test:**

- [ ] Client B disconnects mid-game; client A receives `room:presence { seatId: B, connected: false }`; the room still has B's seat.
- [ ] Client A plays a turn while B is gone (if it is A's turn); no error.
- [ ] B reconnects with its stored `playerToken`; ack view shows the current board and B's real hand; A receives `room:presence { connected: true }`.
- [ ] Reconnect with a garbage token acks `bad-token`.
- [ ] Reconnect to a code whose room was swept acks `room-not-found`.
- [ ] Reconnect is rate-limited past 10 per minute.

- [ ] Commit: `feat(server): presence tracking and seat reconnect`

---

## Task 17: the turn timer

**Files:**

- Create: `apps/server/src/turns/timer.ts`, `apps/server/src/turns/timer.test.ts` (unit)
- Modify: `apps/server/src/socket/handlers/game.ts` and `reconnect.ts` to arm and clear it
- Add cases to `apps/server/src/socket/__tests__/game.test.ts`

**`timer.ts`:**

```ts
export interface TurnTimers {
  arm(code: string, seconds: number, onExpire: () => void): number; // returns endsAt epoch ms
  clear(code: string): void;
  clearAll(): void;
}
export function createTurnTimers(schedule?: {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}): TurnTimers;
```

The `schedule` injection defaults to `setTimeout` / `clearTimeout` and lets the
unit test drive it synchronously.

**On the socket side:** after `game:started` and after every `game:delta` where
the game is still `active` and `room.turnTimerSeconds !== null`, call
`timers.arm(code, room.turnTimerSeconds, () => autoPlay(ctx, code))` and broadcast
`turn:timer { seatId: currentSeatId, endsAt }`. Clear on round end and on the
room emptying.

**`autoPlay(ctx, code)`:** load the room; if not active, return. Build the move
for the current seat: if `pendingDraw > 0` or the hand has no playable card, a
`draw`; then if `room.game.drawnCard` belongs to that seat, a follow-up `pass`.
Run each through `applyPlayerAction` and broadcast the deltas with
`autoPlayed: seatId`.

**Behaviors to test:**

- [ ] Unit: `arm` schedules a call; a synthetic clock firing the callback runs `onExpire` once; `clear` before firing cancels it; re-`arm` on the same code replaces the pending one.
- [ ] Unit: `endsAt` is `now + seconds * 1000` within a small tolerance.
- [ ] Integration: a room created with `turnTimerSeconds: 1`, started, left idle; within ~1.5s a `game:delta` arrives with `autoPlayed` set to the seat that was on the clock, and the turn has moved on.
- [ ] Integration: a room with `turnTimerSeconds: null` never auto-plays (wait 1.5s, assert no delta).
- [ ] Integration: a normal move before expiry clears the old timer (no stray auto-play afterwards).

- [ ] Commit: `feat(server): per-room turn timer with auto-play on expiry`

---

## Task 18: bootstrap and graceful shutdown

**Files:**

- Create: `apps/server/src/app.ts` (composition root), `apps/server/src/app.test.ts`
- Rewrite: `apps/server/src/main.ts`

**`app.ts`:**

```ts
export interface AppHandle {
  httpServer: import('node:http').Server;
  io: Server<ClientToServerEvents, ServerToClientEvents, ..., SocketData>;
  close: () => Promise<void>;
}
export function createApp(config: Config, logger: Logger): AppHandle;
// builds the store, token registry, rate limiters, turn timers, http app, io;
// attaches socket handlers; does NOT listen
```

**`main.ts`:**

```ts
const config = loadConfig();
const logger = createLogger(config);
const app = createApp(config, logger);
app.httpServer.listen(config.port, () => logger.info({ port: config.port }, 'listening'));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'shutting down');
    void app.close().then(() => process.exit(0));
  });
}
```

`app.close()`: stop the HTTP server accepting, `io.close()`, `timers.clearAll()`,
flush the logger.

**Behaviors to test (`app.test.ts`):**

- [ ] `createApp(testConfig, silentLogger)` returns a handle; `httpServer.listen(0)` then a `GET /health` on the assigned port works.
- [ ] `close()` resolves and a follow-up connection attempt fails.
- [ ] `createApp` twice on the same config both work (no shared module state).

- [ ] Commit: `feat(server): composition root and graceful shutdown`

---

## Task 19: the full-game integration suite

**Files:**

- Create: `apps/server/src/__tests__/full-game.test.ts`

This is the milestone's proof. One test file, real clients, no mocks below the
socket boundary.

**Scenarios:**

- [ ] Three players: host creates, two join, host starts, all three play a full round to a win driven only by each client's own view. Assert: every `game:delta` a client received contained only its own hand; the final `game:roundEnded` names the player whose hand emptied; scores add up to the sum of the losers' hand values at the end.
- [ ] Reconnect mid-round: same setup, player 2 disconnects on their turn, the turn timer (set to 1s) auto-plays them once, player 2 reconnects with their token and finishes the round normally.
- [ ] Spectator: a fourth client joins after the start, receives a `SpectatorView` on every delta, and every `game:action` it sends is acked `not-a-player`.
- [ ] Cheat attempt: player 1 emits `game:action` with player 2's `playerId` in the payload; ack is `wrong-actor`; no delta goes out.
- [ ] Match mode: `targetScore: 40`, play rounds via `startNextRound`-style restart... note: the server needs a `room:nextRound` handler or auto-advances. Decide during Task 15: after `game:roundEnded` and `phase` stays `active` with `game.status === 'round-over'`, the host emits `room:start` again to deal the next round, or add a `room:nextRound` host action. Pick `room:nextRound`. Add it in Task 15 and cover it here: play two rounds, assert `game:matchEnded` fires when a score crosses 40.

If `room:nextRound` is added, update Task 15's file list and add a unit test in
`session.test.ts` for a `nextRound(room)` function that calls the engine's
`startNextRound` with the resumed RNG.

- [ ] Commit: `test(server): full-game, reconnect, spectator, and match integration tests`

---

## Task 20: CI and package wiring

**Files:**

- Modify: `.github/workflows/ci.yml` (no change needed if it already runs `pnpm -r`; confirm `pnpm build` covers the new packages and that `@uno/contracts` builds before `@uno/server` via workspace topo order)
- Modify: root `README.md` repo-layout section to mark `packages/contracts` and `apps/server` as landed
- Create: `apps/server/.env.example` note or fold into the root `.env.example` (already has `PORT`, `CORS_ORIGIN`)

**Steps:**

- [ ] Run the whole root pipeline locally: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] Confirm `pnpm --filter @uno/server build` emits `dist/main.js` and `node apps/server/dist/main.js` boots and serves `/health` (then kill it).
- [ ] Push the branch, open the PR, wait for CI, merge.
- [ ] Tag `v0.2.0` on `main`, push the tag.
- [ ] Commit: `ci: build and test the contracts and server packages`

---

## Self-review

**Spec coverage:**

- Resumable RNG: Task 1.
- `packages/contracts` with schemas, event maps, views: Tasks 2, 3, 4.
- Room aggregate and store behind an interface: Tasks 8, 9.
- Room codes, player tokens: Task 7.
- Server-authoritative action flow (parse, resolve seat, actor check, engine, save RNG, broadcast): Task 11 (logic) and Task 15 (socket).
- Redacted views with a leak test: Task 10.
- Every client and server event: Tasks 14, 15, 16.
- Reconnect with a player token, seat kept during an active game: Task 16.
- Turn timer with auto-play: Task 17.
- Security: helmet and CORS (Task 13), zod at every boundary (Tasks 14 to 16), rate limits (Tasks 12, 14, 16), name bounds (Task 3), graceful shutdown (Task 18).
- Integration verification: Tasks 14 to 17 inline, Task 19 end to end.
- Coverage gate 100 percent on contracts and server minus `main.ts`: Tasks 2, 5.

**Gap found and closed:** match mode needs a way to deal the next round. Added
`room:nextRound` (host action) to Task 15 and a `nextRound(room)` session function
to Task 11, covered in Task 19.

**Placeholder scan:** none. Chat, Postgres, bots, and the React client are named
as out of scope in the spec and this plan.

**Type consistency:** `Result<T>` is `{ ok: true; data: T } | { ok: false; error: ProtocolError }` everywhere (contracts `events.ts`). `Room`, `Seat`, `Spectator` defined once in `rooms/room.ts`. `PlayerView` / `SpectatorView` / `BoardView` / `RoomSummary` defined once in contracts `views.ts` and imported by the server. The action-flow function is `applyPlayerAction(room, seatId, action, now)` in every reference. Seat ids and the engine's `playerId` are the same string.
