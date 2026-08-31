# @uno/engine

The rules of UNO as a pure function. No network, no I/O, no framework, no clock.

```ts
import { startRound, applyAction, createRng } from '@uno/engine';

const rng = createRng(1234);
const { state } = startRound(
  [
    { id: 'a', name: 'Ada' },
    { id: 'b', name: 'Béla' },
  ],
  defaultHouseRules(),
  rng,
);

const result = applyAction(state, { type: 'play-card', playerId: 'a', cardId: 'red-7-a' }, { rng });
if (result.ok) {
  // result.state is the next state, result.events describes what happened
}
```

## Why it is shaped this way

The server is authoritative. It runs this engine, and clients only send intents.
For that to hold, the engine has to be:

- **Deterministic.** Every shuffle and draw goes through a seeded PRNG passed in on
  the context. The same seed and the same actions produce the same game, which is
  how we reproduce a reported bug.
- **Pure.** `applyAction` returns a new state and never mutates the input. No
  `Date.now`, no `Math.random`. ESLint blocks both in this package.
- **Serializable.** `GameState` is plain data. The realtime layer sends it as-is on
  reconnect.

## Tests

```bash
pnpm --filter @uno/engine test
pnpm --filter @uno/engine test:coverage
```

Four layers: unit tests per module, scripted full-game scenarios, property-based
invariants (card count, turn validity), and a coverage gate in CI.
