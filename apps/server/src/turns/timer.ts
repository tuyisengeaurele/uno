import { canPlayOn, currentPlayer, type GameAction } from '@uno/engine';

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

/** Play the current seat's turn when their timer runs out. */
async function autoPlay(ctx: HandlerContext, code: string): Promise<void> {
  const room = ctx.store.get(code);
  if (room?.game?.status !== 'active') {
    return;
  }

  const game = room.game;
  const seatId = currentPlayer(game).id;
  const player = game.players.find((p) => p.id === seatId);
  /* c8 ignore next 3 -- the current player is always in the game */
  if (player === undefined) {
    return;
  }

  const top = game.discardPile.at(-1);
  const activeColor = game.activeColor;
  const hasPlayable =
    game.pendingDraw === 0 &&
    top !== undefined &&
    activeColor !== null &&
    player.hand.some((card) => canPlayOn(card, top, activeColor));

  // Draw. If that leaves an unplayed card in hand and nothing forced, pass.
  const moves: GameAction[] = hasPlayable
    ? [
        { type: 'draw', playerId: seatId },
        { type: 'pass', playerId: seatId },
      ]
    : [{ type: 'draw', playerId: seatId }];

  let current = room;
  for (const move of moves) {
    const outcome = applyPlayerAction(current, seatId, move, ctx.now());
    if ('error' in outcome) {
      break;
    }
    current = outcome.room;
    ctx.store.save(current);
    await broadcastDelta(ctx.io, current, outcome.events, seatId);
    if (outcome.roundEnded !== null || outcome.matchEnded !== null) {
      if (outcome.roundEnded !== null) {
        ctx.io.to(code).emit('game:roundEnded', outcome.roundEnded);
      }
      if (outcome.matchEnded !== null) {
        ctx.io.to(code).emit('game:matchEnded', outcome.matchEnded);
      }
      ctx.turnTimers.clear(code);
      return;
    }
  }

  armTurnTimer(ctx, current);
}
