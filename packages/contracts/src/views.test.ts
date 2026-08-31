import type { HouseRules } from '@uno/engine';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { gameActionSchema, houseRulesSchema } from './schemas.js';
import type { ClientToServerEvents, PlayerView, SpectatorView } from './index.js';

describe('contract surface', () => {
  it('re-exports the schemas and types from the package root', () => {
    expect(gameActionSchema).toBeDefined();
    expect(houseRulesSchema).toBeDefined();
  });

  it('house rules parse to a value the engine accepts', () => {
    const parsed: HouseRules = houseRulesSchema.parse({
      stacking: 'off',
      drawUntilPlayable: false,
      playDrawnCard: true,
      jumpIn: false,
      unoPenalty: 2,
      wildFourChallenge: true,
      targetScore: 500,
      firstCardRule: 'official',
    });
    expect(parsed.targetScore).toBe(500);
  });

  it('keeps the view shapes distinguishable by their kind tag', () => {
    const player = { kind: 'player' } as Pick<PlayerView, 'kind'>;
    const spectator = { kind: 'spectator' } as Pick<SpectatorView, 'kind'>;
    expect(player.kind).not.toBe(spectator.kind);
  });
});

// Compile-time only: the event map key set is what we expect.
type EventNames = keyof ClientToServerEvents;
const _names: EventNames[] = [
  'room:create',
  'room:join',
  'room:reconnect',
  'room:leave',
  'room:updateSettings',
  'room:start',
  'room:nextRound',
  'game:action',
];
void _names;

type InferredAction = z.infer<typeof gameActionSchema>;
const _actionHasType: InferredAction['type'] = 'draw';
void _actionHasType;
