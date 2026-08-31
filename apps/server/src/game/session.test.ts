import { describe, expect, it } from 'vitest';

import { defaultHouseRules } from '@uno/engine';

import { addSeat, createRoom, type Room } from '../rooms/room.js';
import { applyPlayerAction, nextRound, startGame } from './session.js';

function lobby(seatCount: number, seed = 4242): Room {
  let room = createRoom({
    code: 'ABCJK2',
    hostName: 'P0',
    houseRules: defaultHouseRules({ targetScore: 200 }),
    turnTimerSeconds: null,
    seed,
    now: 0,
  });
  for (let i = 1; i < seatCount; i += 1) {
    const added = addSeat(room, `P${String(i)}`, 0);
    if (!added.added) throw new Error('seat not added');
    room = added.room;
  }
  return room;
}

function started(seatCount: number, seed?: number): Room {
  const result = startGame(lobby(seatCount, seed), 100);
  if ('error' in result) throw new Error(result.error.code);
  return result.room;
}

describe('startGame', () => {
  it('deals a round and advances the RNG', () => {
    const room = lobby(3);
    const result = startGame(room, 100);
    if ('error' in result) throw new Error(result.error.code);

    expect(result.room.phase).toBe('active');
    expect(result.room.game?.players.every((p) => p.hand.length === 7)).toBe(true);
    expect(result.room.rngState).not.toBe(room.rngState);
  });

  it('refuses a one-seat room', () => {
    expect(startGame(lobby(1), 100)).toEqual({
      error: { code: 'too-few-players', message: expect.any(String) },
    });
  });

  it('refuses to start a second time', () => {
    const active = started(2);
    expect(startGame(active, 200)).toEqual({
      error: { code: 'not-in-lobby', message: expect.any(String) },
    });
  });
});

describe('applyPlayerAction', () => {
  it('rejects an action whose actor is not the sender', () => {
    const room = started(2);
    const current = room.game!.players[room.game!.currentPlayerIndex]!;
    const other = room.game!.players.find((p) => p.id !== current.id)!;

    const result = applyPlayerAction(room, current.id, { type: 'draw', playerId: other.id }, 200);
    expect(result).toEqual({ error: { code: 'wrong-actor', message: expect.any(String) } });
  });

  it('applies a legal draw and advances the RNG', () => {
    const room = started(2);
    const current = room.game!.players[room.game!.currentPlayerIndex]!;

    const result = applyPlayerAction(room, current.id, { type: 'draw', playerId: current.id }, 200);
    if ('error' in result) throw new Error(result.error.code);

    expect(result.events.some((e) => e.type === 'player-drew')).toBe(true);
    expect(result.roundEnded).toBeNull();
    expect(result.room.rngState).not.toBe(room.rngState);
    expect(result.room.lastActivityAt).toBe(200);
  });

  it('passes an engine rule error straight through', () => {
    const room = started(2);
    const current = room.game!.players[room.game!.currentPlayerIndex]!;

    const result = applyPlayerAction(
      room,
      current.id,
      { type: 'play-card', playerId: current.id, cardId: 'not-a-real-card' },
      200,
    );
    expect(result).toEqual({
      error: { code: 'card-not-in-hand', message: expect.any(String) },
    });
  });

  it('checks the accuser on a catch-unfair-uno', () => {
    const room = started(2);
    const [a, b] = room.game!.players;
    const result = applyPlayerAction(
      room,
      a!.id,
      { type: 'catch-unfair-uno', accuserId: b!.id, targetId: a!.id },
      200,
    );
    expect(result).toEqual({ error: { code: 'wrong-actor', message: expect.any(String) } });
  });

  it('checks the challenger on a challenge-wild-four', () => {
    const room = started(2);
    const [a, b] = room.game!.players;
    const result = applyPlayerAction(
      room,
      a!.id,
      { type: 'challenge-wild-four', challengerId: b!.id },
      200,
    );
    expect(result).toEqual({ error: { code: 'wrong-actor', message: expect.any(String) } });
  });

  it('rejects any action before the round starts', () => {
    const room = lobby(2);
    const result = applyPlayerAction(
      room,
      room.hostSeatId,
      { type: 'draw', playerId: room.hostSeatId },
      200,
    );
    expect(result).toEqual({ error: { code: 'no-active-round', message: expect.any(String) } });
  });

  it('rejects an action once the round is over', () => {
    const room = started(2);
    const current = room.game!.players[room.game!.currentPlayerIndex]!;
    const over: Room = { ...room, game: { ...room.game!, status: 'round-over' } };
    const result = applyPlayerAction(over, current.id, { type: 'draw', playerId: current.id }, 200);
    expect(result).toEqual({ error: { code: 'no-active-round', message: expect.any(String) } });
  });

  it('is deterministic: same room and actions from a seed produce the same hands', () => {
    const runOnce = () => {
      const room = started(2, 555);
      const current = room.game!.players[room.game!.currentPlayerIndex]!;
      const out = applyPlayerAction(room, current.id, { type: 'draw', playerId: current.id }, 200);
      if ('error' in out) throw new Error(out.error.code);
      return out.room.game?.players.map((p) => p.hand.map((c) => c.id));
    };
    expect(runOnce()).toEqual(runOnce());
  });

  it('reports a round end when a player empties their hand', () => {
    const room = started(2);
    // Force a near-win state: give the current player a single playable card.
    const game = room.game!;
    const current = game.players[game.currentPlayerIndex]!;
    const top = game.discardPile.at(-1)!;
    const soleCard = { kind: 'number' as const, color: 'red' as const, value: 5, id: 'red-5-win' };
    const doctored: Room = {
      ...room,
      game: {
        ...game,
        activeColor: 'red',
        discardPile: [{ ...top, kind: 'number', color: 'red', value: 9, id: 'red-9-top' }],
        players: game.players.map((p) => (p.id === current.id ? { ...p, hand: [soleCard] } : p)),
      },
    };

    const result = applyPlayerAction(
      doctored,
      current.id,
      { type: 'play-card', playerId: current.id, cardId: 'red-5-win' },
      300,
    );
    if ('error' in result) throw new Error(result.error.code);
    expect(result.roundEnded?.winnerId).toBe(current.id);
    expect(result.matchEnded).toBeNull();
  });
});

describe('nextRound', () => {
  it('deals a fresh round after one ends and keeps the scores', () => {
    const room = started(2);
    const roundOver: Room = {
      ...room,
      game: {
        ...room.game!,
        status: 'round-over',
        roundWinnerId: room.game!.players[0]!.id,
        scores: { [room.game!.players[0]!.id]: 30, [room.game!.players[1]!.id]: 0 },
      },
    };
    const result = nextRound(roundOver, 400);
    if ('error' in result) throw new Error(result.error.code);
    expect(result.room.game?.status).toBe('active');
    expect(result.room.game?.scores[room.game!.players[0]!.id]).toBe(30);
  });

  it('refuses when no round has finished', () => {
    expect(nextRound(started(2), 400)).toEqual({
      error: { code: 'no-active-round', message: expect.any(String) },
    });
  });

  it('refuses before any round has been dealt', () => {
    expect(nextRound(lobby(2), 400)).toEqual({
      error: { code: 'no-active-round', message: expect.any(String) },
    });
  });
});
