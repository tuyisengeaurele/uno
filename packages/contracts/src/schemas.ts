import type { GameAction, HouseRules } from '@uno/engine';
import { z } from 'zod';

/** Trim, drop control and format characters, then require 2 to 20 characters. */
export const displayNameSchema = z
  .string()
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
  .pipe(z.string().min(2).max(20));

/** Six characters from an alphabet with no I, O, 0, or 1. */
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

export const turnTimerSecondsSchema = z.number().int().min(10).max(300).nullable();

export const gameActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('play-card'),
    playerId: z.string().min(1),
    cardId: z.string().min(1),
    chosenColor: cardColorSchema.optional(),
  }),
  z.object({
    type: z.literal('play-drawn'),
    playerId: z.string().min(1),
    cardId: z.string().min(1),
    chosenColor: cardColorSchema.optional(),
  }),
  z.object({ type: z.literal('draw'), playerId: z.string().min(1) }),
  z.object({ type: z.literal('pass'), playerId: z.string().min(1) }),
  z.object({
    type: z.literal('choose-color'),
    playerId: z.string().min(1),
    color: cardColorSchema,
  }),
  z.object({ type: z.literal('call-uno'), playerId: z.string().min(1) }),
  z.object({
    type: z.literal('catch-unfair-uno'),
    accuserId: z.string().min(1),
    targetId: z.string().min(1),
  }),
  z.object({ type: z.literal('challenge-wild-four'), challengerId: z.string().min(1) }),
]);

export const roomCreateSchema = z.object({
  name: displayNameSchema,
  houseRules: houseRulesSchema.partial().optional(),
  turnTimerSeconds: turnTimerSecondsSchema.optional(),
});

export const roomJoinSchema = z.object({
  name: displayNameSchema,
  code: roomCodeSchema,
});

export const roomReconnectSchema = z.object({
  code: roomCodeSchema,
  playerToken: z.string().min(20).max(100),
});

export const roomUpdateSettingsSchema = z.object({
  houseRules: houseRulesSchema,
  turnTimerSeconds: turnTimerSecondsSchema,
});

export const gameActionMessageSchema = z.object({ action: gameActionSchema });

export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
export type RoomJoinInput = z.infer<typeof roomJoinSchema>;
export type RoomReconnectInput = z.infer<typeof roomReconnectSchema>;
export type RoomUpdateSettingsInput = z.infer<typeof roomUpdateSettingsSchema>;
export type GameActionInput = z.infer<typeof gameActionSchema>;

// Compile-time guards that the schemas stay in step with the engine. If the
// engine's action union or house rules gain a field, one of these stops
// compiling.
type Extends<A, B> = A extends B ? true : never;
const _actionsMatchEngine: Extends<GameAction, GameActionInput> = true;
const _houseRulesMatchEngine: Extends<HouseRules, z.infer<typeof houseRulesSchema>> = true;
void _actionsMatchEngine;
void _houseRulesMatchEngine;
