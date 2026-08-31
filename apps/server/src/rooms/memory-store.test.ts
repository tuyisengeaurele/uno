import { describe, expect, it } from 'vitest';

import { defaultHouseRules } from '@uno/engine';

import { createInMemoryRoomStore } from './memory-store.js';
import { createRoom, type Room } from './room.js';

const room = (code: string, now = 1000): Room =>
  createRoom({
    code,
    hostName: 'Ada',
    houseRules: defaultHouseRules(),
    turnTimerSeconds: null,
    seed: 1,
    now,
  });

describe('createInMemoryRoomStore', () => {
  it('stores and returns an equal but separate room', () => {
    const store = createInMemoryRoomStore();
    const original = room('AAAAAA');
    store.create(original);

    const fetched = store.get('AAAAAA');
    expect(fetched).toEqual(original);
    expect(fetched).not.toBe(original);
  });

  it('does not let a caller mutate the stored room', () => {
    const store = createInMemoryRoomStore();
    store.create(room('AAAAAA'));

    const fetched = store.get('AAAAAA');
    fetched?.seats.push({ id: 'x', name: 'ghost', connected: true, disconnectedAt: null });

    expect(store.get('AAAAAA')?.seats).toHaveLength(1);
  });

  it('overwrites on save', () => {
    const store = createInMemoryRoomStore();
    store.create(room('AAAAAA'));
    store.save({ ...room('AAAAAA'), phase: 'active' });
    expect(store.get('AAAAAA')?.phase).toBe('active');
  });

  it('deletes a room', () => {
    const store = createInMemoryRoomStore();
    store.create(room('AAAAAA'));
    store.delete('AAAAAA');
    expect(store.get('AAAAAA')).toBeUndefined();
  });

  it('returns undefined for an unknown code', () => {
    expect(createInMemoryRoomStore().get('NOPE00')).toBeUndefined();
  });

  it('sweeps only rooms past the idle cutoff', () => {
    const store = createInMemoryRoomStore();
    store.create(room('OLD000', 0));
    store.create(room('FRESH0', 9_000));

    const removed = store.sweep(10_000, 5_000);

    expect(removed).toEqual(['OLD000']);
    expect(store.list().map((r) => r.code)).toEqual(['FRESH0']);
  });
});
