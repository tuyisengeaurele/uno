import { describe, expect, it } from 'vitest';

import { createRng, defaultHouseRules, startRound } from '@uno/engine';

import { createRoom, type Room } from '../rooms/room.js';
import { toBoardView, toPlayerView, toRoomSummary, toSpectatorView } from './redact.js';

function activeRoom(): Room {
  const base = createRoom({
    code: 'ABCJK2',
    hostName: 'Ada',
    houseRules: defaultHouseRules(),
    turnTimerSeconds: 45,
    seed: 777,
    now: 1000,
  });
  // Three seats, then deal a round whose player ids are the seat ids.
  const seats = [
    base.seats[0]!,
    { id: 's1', name: 'Béla', connected: true, disconnectedAt: null },
    { id: 's2', name: 'Cyd', connected: false, disconnectedAt: 2000 },
  ];
  const { state } = startRound(
    seats.map((s) => ({ id: s.id, name: s.name })),
    base.houseRules,
    createRng(base.seed),
  );
  return { ...base, seats, phase: 'active', game: state };
}

const noForeignHandLeaks = (view: unknown, foreignCardIds: string[]): void => {
  const serialized = JSON.stringify(view);
  for (const id of foreignCardIds) {
    expect(serialized).not.toContain(id);
  }
};

describe('toPlayerView', () => {
  it('includes the caller full hand and opponents only as counts', () => {
    const room = activeRoom();
    const [me, ...opponents] = room.game!.players;
    const view = toPlayerView(room, me!.id);

    expect(view.self.hand).toEqual(me!.hand);
    expect(view.players.find((p) => p.id === opponents[0]!.id)?.handCount).toBe(7);
    expect(view.players.find((p) => p.id === opponents[0]!.id)).not.toHaveProperty('hand');

    const foreign = opponents.flatMap((p) => p.hand.map((c) => c.id));
    noForeignHandLeaks({ players: view.players, board: view.board }, foreign);
  });

  it('reflects seat connection state', () => {
    const room = activeRoom();
    const view = toPlayerView(room, room.game!.players[0]!.id);
    expect(view.players.find((p) => p.id === 's2')?.connected).toBe(false);
  });

  it('is empty and boardless in the lobby', () => {
    const base = createRoom({
      code: 'LOBBY1',
      hostName: 'Ada',
      houseRules: defaultHouseRules(),
      turnTimerSeconds: null,
      seed: 1,
      now: 0,
    });
    const view = toPlayerView(base, base.hostSeatId);
    expect(view.self.hand).toEqual([]);
    expect(view.board).toBeNull();
    expect(view.players).toHaveLength(1);
  });
});

describe('toSpectatorView', () => {
  it('carries no hand anywhere in the payload', () => {
    const room = activeRoom();
    const view = toSpectatorView(room);
    const allCardIds = room.game!.players.flatMap((p) => p.hand.map((c) => c.id));
    noForeignHandLeaks(view, allCardIds);
    expect(JSON.stringify(view)).not.toContain('"hand"');
  });
});

describe('toBoardView', () => {
  it('maps the current player to a seat id and copies the public board', () => {
    const room = activeRoom();
    const board = toBoardView(room)!;
    const current = room.game!.players[room.game!.currentPlayerIndex]!;
    expect(board.currentSeatId).toBe(current.id);
    expect(board.activeColor).toBe(room.game!.activeColor);
    expect(board.direction).toBe(room.game!.direction);
    expect(board.scores).toEqual(room.game!.scores);
  });

  it('is null in the lobby', () => {
    const base = createRoom({
      code: 'LOBBY2',
      hostName: 'Ada',
      houseRules: defaultHouseRules(),
      turnTimerSeconds: null,
      seed: 1,
      now: 0,
    });
    expect(toBoardView(base)).toBeNull();
  });
});

describe('toRoomSummary', () => {
  it('counts seats and spectators and copies the settings', () => {
    const room = { ...activeRoom(), spectators: [{ id: 'x', name: 'Watcher' }] };
    const summary = toRoomSummary(room);
    expect(summary).toMatchObject({
      code: 'ABCJK2',
      phase: 'active',
      seatCount: 3,
      spectatorCount: 1,
      turnTimerSeconds: 45,
    });
  });
});
