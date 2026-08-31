import { describe, expect, it } from 'vitest';

import { defaultHouseRules } from '@uno/engine';

import {
  addSeat,
  addSpectator,
  canStart,
  createRoom,
  markSeatConnected,
  removeSeat,
  removeSpectator,
  seatById,
  type Room,
} from './room.js';

const room = (overrides: Partial<Parameters<typeof createRoom>[0]> = {}): Room =>
  createRoom({
    code: 'ABCJK2',
    hostName: 'Ada',
    houseRules: defaultHouseRules(),
    turnTimerSeconds: 45,
    seed: 12345,
    now: 1000,
    ...overrides,
  });

describe('createRoom', () => {
  it('starts in the lobby with the host as the only seat', () => {
    const r = room();
    expect(r.phase).toBe('lobby');
    expect(r.seats).toHaveLength(1);
    expect(r.hostSeatId).toBe(r.seats[0]?.id);
    expect(r.game).toBeNull();
    expect(r.rngState).toBe(12345);
  });
});

describe('addSeat', () => {
  it('seats players up to the maximum of ten', () => {
    let r = room();
    for (let i = 0; i < 9; i += 1) {
      const result = addSeat(r, `P${String(i)}`, 2000);
      expect(result.added).toBe(true);
      if (result.added) {
        r = result.room;
      }
    }
    expect(r.seats).toHaveLength(10);
    expect(addSeat(r, 'overflow', 3000)).toEqual({ added: false, reason: 'full' });
  });

  it('refuses to seat a player once the game is active', () => {
    const active: Room = { ...room(), phase: 'active' };
    expect(addSeat(active, 'late', 2000)).toEqual({ added: false, reason: 'closed' });
  });

  it('bumps lastActivityAt', () => {
    const result = addSeat(room(), 'Béla', 5000);
    expect(result.added && result.room.lastActivityAt).toBe(5000);
  });
});

describe('spectators', () => {
  it('adds and removes a spectator', () => {
    const { room: withSpec, spectator } = addSpectator(room(), 'Watcher');
    expect(withSpec.spectators).toHaveLength(1);
    expect(removeSpectator(withSpec, spectator.id).spectators).toHaveLength(0);
  });
});

describe('markSeatConnected', () => {
  it('flips the flag and records or clears the disconnect time', () => {
    const r = room();
    const seatId = r.seats[0]!.id;
    const gone = markSeatConnected(r, seatId, false, 7000);
    expect(seatById(gone, seatId)).toMatchObject({ connected: false, disconnectedAt: 7000 });
    const back = markSeatConnected(gone, seatId, true, 9000);
    expect(seatById(back, seatId)).toMatchObject({ connected: true, disconnectedAt: null });
  });

  it('leaves the other seats untouched', () => {
    const added = addSeat(room(), 'Béla', 2000);
    if (!added.added) throw new Error('seat not added');
    const updated = markSeatConnected(added.room, added.seat.id, false, 7000);
    expect(seatById(updated, updated.hostSeatId)?.connected).toBe(true);
  });
});

describe('removeSeat', () => {
  it('leaves the host unchanged when a non-host leaves', () => {
    const added = addSeat(room(), 'Béla', 2000);
    if (!added.added) throw new Error('seat not added');
    const r = added.room;
    const after = removeSeat(r, added.seat.id);
    expect(after.hostSeatId).toBe(r.hostSeatId);
    expect(after.seats).toHaveLength(1);
  });

  it('promotes the next seat when the host leaves', () => {
    const added = addSeat(room(), 'Béla', 2000);
    if (!added.added) throw new Error('seat not added');
    const after = removeSeat(added.room, added.room.hostSeatId);
    expect(after.hostSeatId).toBe(added.seat.id);
  });

  it('leaves an empty seat list when the last seat goes', () => {
    const r = room();
    const after = removeSeat(r, r.seats[0]!.id);
    expect(after.seats).toEqual([]);
    expect(after.hostSeatId).toBe(r.hostSeatId);
  });
});

describe('canStart', () => {
  it('needs the lobby phase', () => {
    expect(canStart({ ...room(), phase: 'active' })).toEqual({ ok: false, code: 'not-in-lobby' });
  });

  it('needs at least two seats', () => {
    expect(canStart(room())).toEqual({ ok: false, code: 'too-few-players' });
  });

  it('passes with two seats in the lobby', () => {
    const added = addSeat(room(), 'Béla', 2000);
    if (!added.added) throw new Error('seat not added');
    expect(canStart(added.room)).toEqual({ ok: true });
  });
});
