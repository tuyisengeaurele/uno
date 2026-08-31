# Game engine design

Status: approved
Date: 2026-08-31
Scope: monorepo scaffold and the pure UNO rules engine (delivery steps 1 and 2)

## Why the engine comes first

The rules engine is the part of this product most likely to hide bugs. Turn
direction, stacking chains, the Wild Draw Four challenge, and UNO-call timing all
interact, and a wrong edge case is the kind of thing players notice and screenshot.
Everything else (the realtime layer, the UI, the bots) depends on the engine's
shape, so it gets built and tested in isolation before anything else exists.

The engine has no dependency on the server, the client, or the network. It is a
library.

## Monorepo layout

```
uno/
├── pnpm-workspace.yaml
├── tsconfig.base.json          # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── eslint.config.js            # flat config, typescript-eslint strict-type-checked
├── .prettierrc
├── .husky/                     # pre-commit -> lint-staged, commit-msg -> commitlint
├── commitlint.config.cjs
├── .github/workflows/ci.yml    # lint, typecheck, test, build
├── .env.example
├── README.md
└── packages/
    └── engine/                 # this milestone
```

`apps/web`, `apps/server`, and `packages/contracts` are created in their own
milestones so each pull request stays small enough to review. The engine sits at
the bottom of the dependency graph and imports nothing from the rest of the tree.

### Tooling choices

- **pnpm workspaces.** Shared types between the engine, the server, and the client
  need to live in one place and move atomically. Two repositories would add
  version-coordination work with no offsetting benefit for a small team.
- **TypeScript strict**, plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. The engine deals with array indexing constantly
  (hands, the draw pile, player order), so unchecked index access is exactly the
  footgun to disable.
- **Vitest** for the engine. Fast, native ESM and TypeScript, and the same runner
  the frontend will use.

## Engine architecture

### Public surface

One function:

```ts
applyAction(state: GameState, action: GameAction, ctx: EngineContext): ActionResult

type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; error: GameError }
```

Constraints that make this testable and make the server authoritative:

- No I/O, no `Date.now()`, no `Math.random()`.
- All randomness comes through `ctx.rng`, a seeded PRNG we implement ourselves
  (about ten lines). A given seed replays a game exactly, which matters for tests
  and for reproducing a reported bug.
- `GameState` is plain JSON-serializable data with `readonly` types. No class
  instances, no `Map` in the shape that goes over the wire. This is what the
  realtime layer sends on reconnect.
- Every physical card carries a stable `id` (`red-7-b`, `wild-2`). The realtime
  layer diffs hands by id and the UI animates specific cards by id later.

### Events

`applyAction` returns a list of domain events alongside the new state:
`CardPlayed`, `ColorChosen`, `PlayerDrew`, `TurnSkipped`, `DirectionReversed`,
`UnoCalled`, `UnoPenaltyApplied`, `ChallengeResolved`, `RoundEnded`, `MatchEnded`.

The realtime layer broadcasts these. The UI animates from them. The test suite
asserts against them, which is more precise than only checking end state.

### Internal modules

| Module        | Responsibility                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `cards.ts`    | 108-card deck definition, scoring values, `canPlayOn`, `isWild`, `isActionCard`                                              |
| `rng.ts`      | seeded PRNG interface and implementation                                                                                     |
| `deck.ts`     | build, Fisher-Yates shuffle, deal, draw, reshuffle the discard pile into the draw pile when it empties (top card stays down) |
| `state.ts`    | `GameState`, `PlayerState`, per-player UNO tracking                                                                          |
| `config.ts`   | `HouseRules`                                                                                                                 |
| `turn.ts`     | advance, skip, reverse; in a two-player game Reverse acts as Skip                                                            |
| `validate.ts` | per-action legality, returns a typed `GameError`                                                                             |
| `reducer.ts`  | `applyAction` dispatch, event emission                                                                                       |
| `scoring.ts`  | round-end hand scoring, match target check                                                                                   |

Each module is testable on its own. `reducer.ts` is the only one that composes the
others.

## House rules

All configurable from the room settings screen in a later milestone. Defaults
match the official rules with the common tournament restrictions.

| Rule                            | Default    | Notes                                                                             |
| ------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Stacking +2 / +4                | off        | Official. When on, config controls whether +4 stacks on +2                        |
| Draw until playable             | off        | House rule. When off, a player draws exactly one card                             |
| Play the drawn card immediately | on         | If the drawn card is playable the player may play it this turn                    |
| Jump-in                         | off        | House rule, out of scope for the engine milestone but the state model leaves room |
| UNO penalty                     | draw 2     | Configurable to 4                                                                 |
| Wild Draw Four challenge        | on         |                                                                                   |
| Target score (match mode)       | 500        | First player to reach it wins the match                                           |
| First card rules                | `official` | See below                                                                         |

## Three rules where the physical game is ambiguous

The tabletop game resolves these socially. A server-authoritative digital version
needs one concrete model each.

### 1. UNO call window

A player who plays their second-to-last card without calling UNO stays catchable
by any opponent until the next player's action resolves. The window is tracked by
game events, not wall-clock time, so the engine stays pure. The server may add a
wall-clock minimum on top so a fast opponent cannot rob a player who was about to
call.

`CatchUnfairUno` is a `GameAction`. If it lands inside the window, the caught
player draws the UNO penalty. Outside the window it is rejected.

### 2. Wild Draw Four challenge

Resolved deterministically. Before applying a Wild Draw Four the reducer records
whether the player held any card matching the color in play at that moment
(numbers and action cards of that color count, other wilds do not). On
`ChallengeWildFour` from the next player:

- Play was illegal (they held a matching color): the player who played the WD4
  draws 4 and the turn moves past the challenger normally.
- Play was legal (challenge was wrong): the challenger draws 6, which is the
  original 4 plus a 2-card penalty, and is skipped.

The challenger's decision is theirs to make. The resolution is not a guess: the
engine knows the hand.

### 3. First card flipped at round start

`firstCardRules: 'official'`:

- Number card: normal play begins.
- Wild: the first player chooses the color before their turn.
- Wild Draw Four: returned to the deck, the deck is reshuffled, a new card is
  flipped.
- Skip, Reverse, Draw Two: the effect applies to the first player.

`firstCardRules: 'simple'`: any non-number card is reshuffled back until a number
turns up.

## Draw pile exhaustion

When the draw pile is empty, the discard pile below the top card is shuffled with
`ctx.rng` and becomes the new draw pile. If both piles are somehow empty and the
current player has no legal move, they pass. This is rare but the engine must not
throw.

## Testing

Vitest, four layers.

1. **Unit tests** per module.
2. **Scenario tests.** A `playGame(seed, actions[])` harness runs a scripted full
   game and asserts the final state and the event log. Explicit scenarios for the
   listed edge cases: stacking chains, both Wild Draw Four challenge outcomes,
   last-card UNO timing, a draw-pile reshuffle mid-game, and Reverse-as-Skip in a
   two-player game.
3. **Property-based tests** with `fast-check`:
   - the total card count is always 108 across every hand plus both piles
   - a move that validation accepts never throws
   - there is exactly one current player after any sequence of actions
   - the current-player index is always within range
4. **Coverage gate in CI.** Branch coverage threshold starts at 95 percent to
   avoid flaking on unreachable defensive branches, then tightens toward 100 as
   the suite fills in.

## Commit plan

Two branches, each opened as a pull request against `main` and merged.

`chore/monorepo-scaffold`:

- pnpm workspace and base TypeScript config
- ESLint and Prettier
- husky, lint-staged, commitlint
- CI workflow
- README with setup and the reasoning behind each library choice

`feat/game-engine`:

- card model and the 108-card deck
- seeded RNG and Fisher-Yates shuffle
- deal, draw, discard reshuffle
- game state and house-rules config
- turn order with skip, reverse, and reverse-as-skip
- play-card validation and application
- draw, draw-until-playable, play-after-draw
- +2 / +4 stacking accumulation and resolution
- wild color choice and first-card rules
- UNO call, catch penalty, grace window
- Wild Draw Four challenge resolution
- round and match scoring
- scenario tests
- property-based invariants
- public API from `index.ts`
- coverage thresholds in CI

Milestone tagged `v0.1.0` once the engine suite is green.
