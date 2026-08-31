# Game engine implementation plan

**Goal:** Ship the monorepo scaffold and a pure, fully tested UNO rules engine that the realtime layer and UI can build on.

**Architecture:** One pure entry point, `applyAction(state, action, ctx)`, returns a new immutable `GameState` plus a list of domain events, or a typed error. No I/O, no wall-clock, no ambient randomness. Randomness enters through a seeded PRNG on `ctx`. Internal modules are split by responsibility (cards, deck, turn order, validation, scoring) and composed only in the reducer.

**Tech stack:** pnpm workspaces, TypeScript strict, Vitest, fast-check for property tests.

**Reference:** [docs/specs/2026-08-31-game-engine-design.md](../specs/2026-08-31-game-engine-design.md)

Work happens on two branches, each merged to `main` through a pull request:
`chore/monorepo-scaffold`, then `feat/game-engine`. Every commit builds and passes
tests. Milestone tagged `v0.1.0` when the engine suite is green.

---

## Part 1: monorepo scaffold (`chore/monorepo-scaffold`)

### Task 1: workspace root

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitattributes`, `.nvmrc`

**Steps:**
- [ ] `.gitattributes` with `* text=auto eol=lf` so line endings are stable across Windows and Linux (CI and local dev disagree otherwise).
- [ ] `.nvmrc` pinned to `22`.
- [ ] Root `package.json`: private, `packageManager` field pinned to the pnpm version, workspace scripts (`lint`, `typecheck`, `test`, `build`) that fan out with `pnpm -r`. No dependencies yet beyond dev tooling added in later tasks.
- [ ] `pnpm-workspace.yaml` listing `packages/*` and `apps/*`.
- [ ] `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `moduleResolution: bundler`, `target: ES2022`, `isolatedModules`. No `outDir` here, packages extend and set their own.
- [ ] Commit: `chore: set up pnpm workspace and base typescript config`

### Task 2: linting and formatting

**Files:**
- Create: `eslint.config.js`, `.prettierrc`, `.prettierignore`

**Steps:**
- [ ] Install `eslint`, `typescript-eslint`, `eslint-config-prettier`, `prettier` at the root.
- [ ] `eslint.config.js` (flat): `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, project service enabled, `eslint-config-prettier` last. Rule adjustments: allow `void` for floating promises marked intentional, error on `no-console` in `packages/**` (the engine has no business logging), error on `no-restricted-syntax` for `Math.random` and `Date.now` inside `packages/engine/src`.
- [ ] `.prettierrc`: 100 print width, single quotes, no semicolons off (keep semicolons), trailing commas `all`.
- [ ] Verify: `pnpm lint` runs clean on the empty tree.
- [ ] Commit: `chore: add eslint flat config and prettier`

### Task 3: commit hooks

**Files:**
- Create: `.husky/pre-commit`, `.husky/commit-msg`, `commitlint.config.cjs`, `.lintstagedrc.json`

**Steps:**
- [ ] Install `husky`, `lint-staged`, `@commitlint/cli`, `@commitlint/config-conventional`.
- [ ] `commitlint.config.cjs` extends config-conventional, `type-enum` locked to `feat, fix, chore, refactor, test, docs, ci, perf, build, style`.
- [ ] `.lintstagedrc.json`: run `eslint --fix` and `prettier --write` on staged `*.{ts,tsx,js,cjs}`, `prettier --write` on `*.{json,md,yml}`.
- [ ] `pre-commit` runs `pnpm lint-staged`. `commit-msg` runs `pnpm commitlint --edit`.
- [ ] `prepare` script in root `package.json` runs `husky`.
- [ ] Verify: a commit with a bad message (`git commit -m "bad message"`) is rejected.
- [ ] Commit: `chore: enforce conventional commits and staged-file linting`

### Task 4: CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Steps:**
- [ ] Triggers: `push` to `main`, `pull_request`.
- [ ] One job, matrix on Node 22. Steps: checkout, pnpm/action-setup, setup-node with pnpm cache, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- [ ] Second job `audit`: `pnpm audit --audit-level=high`, non-blocking for now via `continue-on-error: true` with a note in the README that findings are triaged weekly. This gets tightened when dependencies stabilize.
- [ ] Commit: `ci: run lint, typecheck, tests, and build on push and pr`

### Task 5: README

**Files:**
- Create: `README.md`, `.env.example`

**Steps:**
- [ ] README sections: what this is (two paragraphs, no marketing voice), prerequisites (Node 22, pnpm, Docker for later milestones), install, common scripts, repo layout, the reasoning behind pnpm / Socket.IO / Zustand / in-memory store / Fly.io + Vercel (one short paragraph each, pulled from the spec), how to run engine tests, contribution notes (conventional commits, branch naming).
- [ ] `.env.example` with commented placeholders for `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `SENTRY_DSN`, `CORS_ORIGIN`. Real values never committed.
- [ ] Commit: `docs: add readme and env example`

### Task 6: open and merge the scaffold PR

- [ ] Push `chore/monorepo-scaffold`, open PR against `main` with a short description of what landed, merge with a merge commit.

---

## Part 2: game engine (`feat/game-engine`)

Branch from `main` after the scaffold merges. Package lives at `packages/engine`
with its own `package.json` (name `@uno/engine`, type module), `tsconfig.json`
extending the base, and `vitest.config.ts`.

TDD throughout: write the test, watch it fail, implement, watch it pass, commit.
Each task below lists the behaviors to test. Write one `it` per behavior with a
descriptive name. Test files sit next to the source (`cards.ts` ->
`cards.test.ts`).

### Task 7: engine package skeleton

**Files:**
- Create: `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/vitest.config.ts`, `packages/engine/src/index.ts` (empty export), `packages/engine/README.md`

**Steps:**
- [ ] `package.json` scripts: `test` (`vitest run`), `test:watch` (`vitest`), `typecheck` (`tsc --noEmit`), `build` (`tsc -p tsconfig.build.json`).
- [ ] Install `vitest`, `@vitest/coverage-v8`, `fast-check` as dev deps.
- [ ] `vitest.config.ts`: coverage provider v8, `all: true`, include `src/**`, thresholds `branches: 95, functions: 95, lines: 95, statements: 95`.
- [ ] Verify: `pnpm --filter @uno/engine test` runs and reports no tests.
- [ ] Commit: `chore(engine): scaffold engine package with vitest`

### Task 8: card model and deck definition

**Files:**
- Create: `packages/engine/src/cards.ts`, `packages/engine/src/cards.test.ts`

**Types:**
- `CardColor = 'red' | 'yellow' | 'green' | 'blue'`
- `CardKind` covers `'number'`, `'skip'`, `'reverse'`, `'draw-two'`, `'wild'`, `'wild-draw-four'`
- `Card`: discriminated by kind. Number cards have `color` and `value: 0..9`. Skip/reverse/draw-two have `color`. Wilds have no color. Every card has a stable `id: string`.

**Behaviors to test:**
- [ ] `buildDeck()` returns 108 cards.
- [ ] Exactly one 0 per color, two each of 1 through 9 per color.
- [ ] Two each of skip, reverse, draw-two per color.
- [ ] Four wild, four wild-draw-four.
- [ ] Every card `id` is unique.
- [ ] `cardValue(card)` returns 0-9 for numbers, 20 for skip/reverse/draw-two, 50 for wilds (round scoring).
- [ ] `isWild`, `isActionCard` type guards behave.
- [ ] `canPlayOn(card, topCard, activeColor)`: matches color, matches number value, matches action kind, wild always plays, wild-draw-four always plays (challenge is separate), a wild on top uses `activeColor` not the card's absent color.

**Steps per behavior:** test -> fail -> implement -> pass. Commit after the deck construction tests pass, then again after the helpers.
- [ ] Commit: `feat(engine): add card model and standard 108-card deck`
- [ ] Commit: `feat(engine): add card matching and scoring helpers`

### Task 9: seeded RNG

**Files:**
- Create: `packages/engine/src/rng.ts`, `packages/engine/src/rng.test.ts`

**Types:**
- `Rng`: `{ next(): number /* [0,1) */; int(maxExclusive: number): number }`
- `createRng(seed: number): Rng` using mulberry32.

**Behaviors to test:**
- [ ] Same seed produces the same sequence.
- [ ] Different seeds diverge.
- [ ] `int(n)` stays in `[0, n)` over a large sample.
- [ ] `int` is uniform enough: chi-square over 10 buckets on 100k draws is under the 0.001 critical value.
- [ ] Commit: `feat(engine): add seeded prng`

### Task 10: deck operations

**Files:**
- Create: `packages/engine/src/deck.ts`, `packages/engine/src/deck.test.ts`

**Functions:**
- `shuffle(cards, rng)`: Fisher-Yates, returns a new array, does not mutate input.
- `deal(deck, playerCount, handSize)`: returns `{ hands: Card[][], drawPile: Card[] }`.
- `drawCards(drawPile, discardPile, count, rng)`: returns `{ drawn, drawPile, discardPile }`. When the draw pile runs out, shuffle everything in the discard pile except the top card back into the draw pile and continue.

**Behaviors to test:**
- [ ] `shuffle` is a permutation (same multiset), input untouched, deterministic for a seed.
- [ ] `deal` for 2 players, hand size 7, leaves 94 in the draw pile; every hand has 7.
- [ ] `drawCards` for a count smaller than the pile just moves cards.
- [ ] `drawCards` when the pile is short triggers a reshuffle and still returns the full count; total card count is conserved; the discard top is preserved.
- [ ] `drawCards` when both piles cannot satisfy the count returns as many as available without throwing.
- [ ] Commit: `feat(engine): add shuffle, deal, and draw with discard reshuffle`

### Task 11: game state and config

**Files:**
- Create: `packages/engine/src/config.ts`, `packages/engine/src/state.ts`, `packages/engine/src/config.test.ts`

**Types:**
- `HouseRules` with every field from the spec table. `defaultHouseRules()` returns the documented defaults.
- `StackingRule = 'off' | 'draw-two' | 'draw-four' | 'both'`
- `PlayerState`: `id`, `name`, `hand: Card[]`, `hasCalledUno: boolean`, `saidUnoAtHandSize: number | null`
- `GameState`: `players`, `currentPlayerIndex`, `direction: 1 | -1`, `drawPile`, `discardPile`, `activeColor: CardColor | null`, `pendingDraw: number`, `pendingDrawKind: 'draw-two' | 'draw-four' | null`, `pendingWildFour: { playerId: string; colorInPlayBefore: CardColor; playerHadColorMatch: boolean } | null`, `unoWindow: { playerId: string } | null`, `status: 'active' | 'round-over' | 'match-over'`, `roundWinnerId: string | null`, `scores: Record<string, number>`, `config: HouseRules`, `rngState` note: the reducer takes the rng on `ctx`, state does not carry it.

**Behaviors to test:**
- [ ] `defaultHouseRules()` matches the spec table exactly.
- [ ] `HouseRules` overrides merge shallowly over the defaults.
- [ ] `GameState` round-trips through `JSON.parse(JSON.stringify(state))` unchanged (guards against accidental `Map`/`Set`/class use).
- [ ] Commit: `feat(engine): define game state and house rules`

### Task 12: round setup

**Files:**
- Create: `packages/engine/src/setup.ts`, `packages/engine/src/setup.test.ts`

**Functions:**
- `startRound(players: {id,name}[], config, rng, scores?)`: builds and shuffles the deck, deals 7 each, flips the first card, applies `firstCardRules`, returns `{ state, events }`.

**Behaviors to test:**
- [ ] 2 to 10 players accepted; fewer than 2 or more than 10 returns an error.
- [ ] Each player holds 7 cards; card count totals 108.
- [ ] First card a number: `activeColor` is its color, `currentPlayerIndex` is 0.
- [ ] First card wild (official rules): state carries a "first player chooses color" marker and the first legal action is `ChooseColor`.
- [ ] First card wild-draw-four (official): it goes back, deck reshuffled, another flipped; the final top card is never a wild-draw-four.
- [ ] First card skip (official): player 0 is skipped, turn is on player 1.
- [ ] First card reverse (official): direction flips before play; with 2 players player 0 plays again after the effect.
- [ ] First card draw-two (official): player 0 draws 2 and is skipped.
- [ ] `firstCardRules: 'simple'`: the first card is always a number.
- [ ] Commit: `feat(engine): deal rounds and apply first-card rules`

### Task 13: turn order

**Files:**
- Create: `packages/engine/src/turn.ts`, `packages/engine/src/turn.test.ts`

**Functions:**
- `nextIndex(current, direction, playerCount, step = 1)`
- `advanceTurn(state, { skip?: boolean })`: returns the next `currentPlayerIndex` honoring direction and skip.
- `applyReverse(state)`: flips direction; documented that the caller handles the 2-player case by also skipping.

**Behaviors to test:**
- [ ] `nextIndex` wraps in both directions.
- [ ] `advanceTurn` with `skip` jumps two seats.
- [ ] `applyReverse` flips `1` to `-1` and back.
- [ ] Reverse with exactly 2 players, composed at the reducer level, returns the turn to the same player (covered again in Task 14 scenarios).
- [ ] Commit: `feat(engine): add turn advancement with skip and reverse`

### Task 14: play a card

**Files:**
- Create: `packages/engine/src/validate.ts`, `packages/engine/src/reducer.ts`, `packages/engine/src/errors.ts`, `packages/engine/src/reducer.test.ts`

**Types:**
- `GameAction` union starts here: `{ type: 'play-card'; playerId: string; cardId: string; chosenColor?: CardColor }`
- `GameError`: `{ code: GameErrorCode; message: string }` with codes like `not-your-turn`, `card-not-in-hand`, `illegal-play`, `color-required`, `color-not-allowed`.
- `ActionResult` as in the spec.
- `EngineContext = { rng: Rng }`

**Behaviors to test (play-card only):**
- [ ] Playing out of turn returns `not-your-turn`.
- [ ] Playing a card not in hand returns `card-not-in-hand`.
- [ ] Playing a card that does not match color, value, or kind returns `illegal-play`.
- [ ] A legal number card: it moves to the discard pile, `activeColor` updates, hand shrinks, turn advances by one, `CardPlayed` event emitted.
- [ ] Playing a wild without `chosenColor` returns `color-required`.
- [ ] Playing a wild with `chosenColor` sets `activeColor`, emits `CardPlayed` then `ColorChosen`.
- [ ] Skip: next player loses their turn, `TurnSkipped` emitted.
- [ ] Reverse with 3+ players: direction flips, `DirectionReversed` emitted.
- [ ] Reverse with 2 players: original player plays again.
- [ ] Playing your last card sets `status: 'round-over'`, `roundWinnerId`, emits `RoundEnded`.
- [ ] Commit after the validation errors pass: `feat(engine): validate play-card actions`
- [ ] Commit after effects pass: `feat(engine): apply number, skip, reverse, and wild plays`

### Task 15: drawing

**Files:**
- Modify: `packages/engine/src/reducer.ts`, `packages/engine/src/validate.ts`, `packages/engine/src/reducer.test.ts`

**Actions added:**
- `{ type: 'draw'; playerId: string }`
- `{ type: 'play-drawn'; playerId: string; cardId: string; chosenColor?: CardColor }`
- `{ type: 'pass'; playerId: string }`

**Behaviors to test:**
- [ ] `draw` out of turn returns `not-your-turn`.
- [ ] `draw` with `drawUntilPlayable: false`: exactly one card enters the hand. If it is playable the player may `play-drawn` or `pass`; if not, the turn auto-advances and `pass` is not required.
- [ ] `draw` with `drawUntilPlayable: true`: cards are drawn until one is playable (or the piles are exhausted), only the last may be played.
- [ ] `play-drawn` with a card that was not the one just drawn returns `illegal-play`.
- [ ] `pass` after a mandatory draw advances the turn.
- [ ] `pass` when the player has not drawn returns an error.
- [ ] `PlayerDrew` event carries the count.
- [ ] Commit: `feat(engine): handle draw, draw-until-playable, and play-after-draw`

### Task 16: stacking +2 and +4

**Files:**
- Modify: `packages/engine/src/reducer.ts`, `packages/engine/src/validate.ts`, `packages/engine/src/reducer.test.ts`

**Behaviors to test:**
- [ ] Stacking `off`: a draw-two makes the next player draw 2 and lose their turn immediately; `pendingDraw` returns to 0.
- [ ] Stacking `draw-two`: the next player may play another draw-two, `pendingDraw` becomes 4, turn passes without drawing.
- [ ] A player facing a stack who cannot or will not continue draws the whole `pendingDraw` and is skipped.
- [ ] Stacking `both`: a draw-four may be played on a pending draw-two stack; `pendingDrawKind` switches to `draw-four`.
- [ ] Stacking `draw-four`: a draw-four stacks on a draw-four but a draw-two cannot be added.
- [ ] Long chain: four consecutive draw-twos then a draw, the drawing player takes 8.
- [ ] Card conservation holds across the whole chain.
- [ ] Commit: `feat(engine): accumulate and resolve +2 and +4 stacking`

### Task 17: UNO call and catch

**Files:**
- Modify: `packages/engine/src/reducer.ts`, `packages/engine/src/reducer.test.ts`

**Actions added:**
- `{ type: 'call-uno'; playerId: string }`
- `{ type: 'catch-unfair-uno'; accuserId: string; targetId: string }`

**Behaviors to test:**
- [ ] A player at 2 cards may `call-uno` pre-emptively; when they play to 1 card no penalty is possible.
- [ ] A player who plays to 1 card without calling opens `unoWindow` for that player.
- [ ] `catch-unfair-uno` inside the window: the target draws the configured penalty (2 by default), `UnoPenaltyApplied` emitted, window closes.
- [ ] `catch-unfair-uno` after the next player has acted: returns an error, no penalty.
- [ ] `catch-unfair-uno` targeting a player not at 1 card: error.
- [ ] `call-uno` by the vulnerable player before they are caught closes the window with no penalty.
- [ ] A player who draws back up above 1 card clears their `hasCalledUno` flag.
- [ ] Commit: `feat(engine): add uno call, catch penalty, and grace window`

### Task 18: Wild Draw Four challenge

**Files:**
- Modify: `packages/engine/src/reducer.ts`, `packages/engine/src/reducer.test.ts`

**Action added:**
- `{ type: 'challenge-wild-four'; challengerId: string }`

**Behaviors to test:**
- [ ] When a wild-draw-four is played, `pendingWildFour` records `colorInPlayBefore` and whether the player held a matching-color card.
- [ ] The next player may `challenge-wild-four` before drawing or playing.
- [ ] Challenge succeeds (player did hold a matching color): the player who played it draws 4, `pendingDraw` clears, the challenger takes their normal turn, `ChallengeResolved` with `upheld: true`.
- [ ] Challenge fails (play was legal): the challenger draws 6 and is skipped, `ChallengeResolved` with `upheld: false`.
- [ ] Holding only wilds plus off-color cards is a legal wild-draw-four (challenge fails).
- [ ] Once the challenger draws or plays, the challenge window is gone.
- [ ] With stacking `both` or `draw-four`, a challenge is offered before the option to stack; choosing to stack forfeits the challenge.
- [ ] Commit: `feat(engine): resolve wild draw four challenges`

### Task 19: scoring and match mode

**Files:**
- Create: `packages/engine/src/scoring.ts`, `packages/engine/src/scoring.test.ts`
- Modify: `packages/engine/src/reducer.ts`

**Functions:**
- `scoreRound(state)`: sums every non-winner hand by `cardValue`, adds it to the winner's score.
- `startNextRound(state, rng)`: rotates the starting player, re-deals, keeps `scores`.

**Behaviors to test:**
- [ ] Round score sums opponents' hands onto the winner.
- [ ] Reaching `targetScore` sets `status: 'match-over'` and emits `MatchEnded`.
- [ ] Below target, `startNextRound` deals a fresh round and preserves scores.
- [ ] The starting player rotates each round.
- [ ] Commit: `feat(engine): add round and match scoring`

### Task 20: public API

**Files:**
- Modify: `packages/engine/src/index.ts`
- Create: `packages/engine/src/index.test.ts`

**Steps:**
- [ ] Export `applyAction`, `startRound`, `startNextRound`, `scoreRound`, `createRng`, `defaultHouseRules`, `buildDeck`, `cardValue`, and every public type.
- [ ] Do not export internal helpers (`validate`, `turn` internals).
- [ ] Test: importing from the package root gives a working `startRound` -> `applyAction` loop for a tiny scripted game.
- [ ] Commit: `feat(engine): expose public api from index`

### Task 21: scenario tests

**Files:**
- Create: `packages/engine/src/__scenarios__/harness.ts`, `packages/engine/src/__scenarios__/games.test.ts`

**Harness:**
- `playGame(seed, players, config, actions)`: starts a round, applies each action in order, throws with context if any returns `ok: false`, returns the final state plus the full event list.

**Scenarios to script and assert:**
- [ ] A complete 2-player game from deal to a round win.
- [ ] A 4-player game where a reverse and a skip both fire.
- [ ] A stacking chain of three draw-twos resolved by a draw.
- [ ] A successful wild-draw-four challenge and its penalty.
- [ ] A failed wild-draw-four challenge and its penalty.
- [ ] A player caught not calling UNO.
- [ ] A player who calls UNO in time and is safe.
- [ ] A forced draw-pile reshuffle: script enough draws to empty the pile and assert conservation and continuity.
- [ ] Reverse-as-skip in a 2-player game across several turns.
- [ ] A full match to a low `targetScore` across three rounds.
- [ ] Commit: `test(engine): scripted full-game scenarios`

### Task 22: property-based invariants

**Files:**
- Create: `packages/engine/src/__scenarios__/invariants.test.ts`

**Approach:** a fast-check `Arbitrary` that, given a seed, generates a random but always-legal sequence of actions by asking the engine for legal moves at each step and picking one. Run 500 sequences.

**Invariants to assert after every step:**
- [ ] Total card count across all hands, the draw pile, and the discard pile equals 108.
- [ ] No card `id` appears in two places.
- [ ] `currentPlayerIndex` is in `[0, playerCount)`.
- [ ] `direction` is `1` or `-1`.
- [ ] If `status` is `active`, at least one player has cards.
- [ ] Any action the generator picked from the legal set returns `ok: true` (a legal move never throws or is rejected).
- [ ] `pendingDraw` is 0 whenever `pendingDrawKind` is null and positive otherwise.
- [ ] Commit: `test(engine): property-based invariants for state integrity`

### Task 23: tighten coverage and finish

**Files:**
- Modify: `packages/engine/vitest.config.ts`, `.github/workflows/ci.yml`

**Steps:**
- [ ] Raise coverage thresholds to `branches: 100` where practical; add `/* c8 ignore next */` only on genuinely unreachable defensive branches with a one-line reason.
- [ ] Confirm `pnpm --filter @uno/engine test` is green with coverage passing.
- [ ] Push `feat/game-engine`, open PR, merge.
- [ ] Tag `v0.1.0` on `main`, push the tag.
- [ ] Commit (config only): `test(engine): raise branch coverage gate to 100`

---

## Self-review

**Spec coverage:**
- 108-card deck, deal 7, draw/discard: Tasks 8, 10, 12.
- Turn order, reversal, skip, draw-two/four with color: Tasks 13, 14, 16.
- Stacking configurable per room: Task 16.
- Draw when no play, play immediately after drawing: Task 15.
- UNO call, penalty, grace window: Task 17.
- Wild Draw Four challenge: Task 18.
- Scoring across rounds, match mode: Task 19.
- Win condition: Task 14 (last card) and Task 19 (match).
- Three ambiguous rules (UNO window, WD4 resolution, first card): Tasks 12, 17, 18.
- Seeded determinism: Task 9, used everywhere.
- Serialization for reconnect: Task 11.
- Four test layers: Tasks 8-20 (unit), 21 (scenario), 22 (property), 7/23 (coverage gate).
- Monorepo tooling with strict TS, ESLint, Prettier, husky, commitlint, CI: Tasks 1-5.

No gaps found.

**Placeholder scan:** none. Bots, jump-in, and the room-settings UI are explicitly out of scope for this milestone and are named as such in the spec.

**Type consistency:** `GameState`, `GameAction`, `ActionResult`, `GameError`, `HouseRules`, `Rng`, `EngineContext` are defined once (Tasks 11, 14, 9) and referenced by those names throughout. Action `type` strings are kebab-case everywhere (`play-card`, `play-drawn`, `catch-unfair-uno`, `challenge-wild-four`). Events are PascalCase (`CardPlayed`, `RoundEnded`).
