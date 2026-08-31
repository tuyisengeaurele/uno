import { describe, expect, it, vi } from 'vitest';

import { createTurnTimers, type Scheduler } from './timer.js';

function fakeScheduler(): Scheduler & { run: () => void; pending: number } {
  let queued: (() => void) | null = null;
  let handleSeq = 0;
  return {
    set(fn) {
      queued = fn;
      handleSeq += 1;
      return handleSeq;
    },
    clear() {
      queued = null;
    },
    run() {
      const fn = queued;
      queued = null;
      fn?.();
    },
    get pending() {
      return queued === null ? 0 : 1;
    },
  };
}

describe('createTurnTimers', () => {
  it('runs the callback once when the timer fires', () => {
    const scheduler = fakeScheduler();
    const timers = createTurnTimers(scheduler);
    const onExpire = vi.fn();

    timers.arm('ROOM01', 30, onExpire);
    scheduler.run();
    scheduler.run();

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not fire after clear', () => {
    const scheduler = fakeScheduler();
    const timers = createTurnTimers(scheduler);
    const onExpire = vi.fn();

    timers.arm('ROOM01', 30, onExpire);
    timers.clear('ROOM01');
    scheduler.run();

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('re-arming a room replaces the pending timer', () => {
    const scheduler = fakeScheduler();
    const timers = createTurnTimers(scheduler);
    const first = vi.fn();
    const second = vi.fn();

    timers.arm('ROOM01', 30, first);
    timers.arm('ROOM01', 30, second);
    scheduler.run();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('returns a deadline roughly now plus the duration', () => {
    const timers = createTurnTimers(fakeScheduler());
    const before = Date.now();
    const endsAt = timers.arm('ROOM01', 20, () => undefined);
    expect(endsAt).toBeGreaterThanOrEqual(before + 20_000);
    expect(endsAt).toBeLessThan(before + 21_000);
  });

  it('clearAll cancels every pending timer', () => {
    const scheduler = fakeScheduler();
    const timers = createTurnTimers(scheduler);
    const a = vi.fn();

    timers.arm('ROOM01', 30, a);
    timers.clearAll();
    scheduler.run();

    expect(a).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(0);
  });

  it('clearing an unknown room is a no-op', () => {
    const timers = createTurnTimers(fakeScheduler());
    expect(() => {
      timers.clear('NOPE00');
    }).not.toThrow();
  });
});
