import { currentPlayer } from '@uno/engine';

import { applyPlayerAction } from '../game/session.js';
import type { Room } from '../rooms/room.js';
import { broadcastDelta, type HandlerContext } from '../socket/context.js';

export interface Scheduler {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realScheduler: Scheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export interface TurnTimers {
  /** Schedule `onExpire` for a room's current turn. Returns the epoch-ms deadline. */
  arm(code: string, seconds: number, onExpire: () => void): number;
  clear(code: string): void;
  clearAll(): void;
}

export function createTurnTimers(scheduler: Scheduler = realScheduler): TurnTimers {
  const handles = new Map<string, unknown>();

  const clear = (code: string): void => {
    const handle = handles.get(code);
    if (handle !== undefined) {
      scheduler.clear(handle);
      handles.delete(code);
    }
  };

  return {
    arm(code, seconds, onExpire) {
      clear(code);
      const ms = seconds * 1000;
      handles.set(
        code,
        scheduler.set(() => {
          handles.delete(code);
          onExpire();
        }, ms),
      );
      return Date.now() + ms;
    },
    clear,
    clearAll() {
      for (const code of [...handles.keys()]) {
        clear(code);
      }
    },
  };
}

/** Start (or restart) the turn clock for a room and tell its clients. */
export function armTurnTimer(ctx: HandlerContext, room: Room): void {
  const seconds = room.turnTimerSeconds;
  if (seconds === null || room.game?.status !== 'active') {
    return;
  }
  const seatId = currentPlayer(room.game).id;
  const endsAt = ctx.turnTimers.arm(room.code, seconds, () => {
    void autoPlay(ctx, room.code);
  });
  ctx.io.to(room.code).emit('turn:timer', { seatId, endsAt });
}

export function clearTurnTimer(ctx: HandlerContext, code: string): void {
  ctx.turnTimers.clear(code);
}

/**
 * Play the current seat's turn when their timer runs out: draw a card, and if
 * that leaves a drawn card still in their hands, pass it. Drawing never wins a
 * round, so this cannot end the game.
 */
async function autoPlay(ctx: HandlerContext, code: string): Promise<void> {
  const room = ctx.store.get(code);
  /* c8 ignore next 3 -- the timer is cleared when a round ends; this guards a race */
  if (room?.game?.status !== 'active') {
    return;
  }
  const seatId = currentPlayer(room.game).id;

  const drew = applyPlayerAction(room, seatId, { type: 'draw', playerId: seatId }, ctx.now());
  /* c8 ignore next 3 -- a server-issued draw is always legal on the current turn */
  if ('error' in drew) {
    return;
  }
  let current = drew.room;
  ctx.store.save(current);
  await broadcastDelta(ctx.io, current, drew.events, seatId);

  if (current.game?.drawnCard?.playerId === seatId) {
    const passed = applyPlayerAction(
      current,
      seatId,
      { type: 'pass', playerId: seatId },
      ctx.now(),
    );
    /* c8 ignore next 3 -- passing a just-drawn card is always legal */
    if ('error' in passed) {
      return;
    }
    current = passed.room;
    ctx.store.save(current);
    await broadcastDelta(ctx.io, current, passed.events, seatId);
  }

  armTurnTimer(ctx, current);
}
