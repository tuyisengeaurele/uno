import { gameActionMessageSchema, type Result, roomUpdateSettingsSchema } from '@uno/contracts';
import type { HouseRules } from '@uno/engine';

import { protocolError, type ProtocolError } from '../../errors.js';
import { toRoomSummary } from '../../game/redact.js';
import { applyPlayerAction, nextRound, startGame } from '../../game/session.js';
import { broadcastDelta, broadcastStarted, type HandlerContext } from '../context.js';
import { armTurnTimer, clearTurnTimer } from '../../turns/timer.js';

const fail = (code: ProtocolError['code'], message: string): Result<never> => ({
  ok: false,
  error: protocolError(code, message),
});

const done: Result<Record<string, never>> = { ok: true, data: {} };

export function registerGameHandlers(ctx: HandlerContext): void {
  ctx.socket.on('room:updateSettings', (payload, ack) => {
    handleUpdateSettings(ctx, payload, ack);
  });
  ctx.socket.on('room:start', (ack) => {
    void handleStart(ctx, ack);
  });
  ctx.socket.on('room:nextRound', (ack) => {
    void handleNextRound(ctx, ack);
  });
  ctx.socket.on('game:action', (payload, ack) => {
    void handleAction(ctx, payload, ack);
  });
}

function hostRoom(ctx: HandlerContext): { code: string } | { error: ProtocolError } {
  const { code, seatId } = ctx.socket.data;
  if (code === null || seatId === null) {
    return { error: protocolError('not-a-player', 'join a room first') };
  }
  const room = ctx.store.get(code);
  if (room === undefined) {
    return { error: protocolError('room-not-found', 'this room no longer exists') };
  }
  if (room.hostSeatId !== seatId) {
    return { error: protocolError('not-host', 'only the host can do that') };
  }
  return { code };
}

function handleUpdateSettings(
  ctx: HandlerContext,
  payload: unknown,
  ack: (r: Result<Record<string, never>>) => void,
): void {
  const parsed = roomUpdateSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    ack(fail('invalid-payload', 'the settings payload did not validate'));
    return;
  }
  const host = hostRoom(ctx);
  if ('error' in host) {
    ack({ ok: false, error: host.error });
    return;
  }
  const room = ctx.store.get(host.code);
  /* c8 ignore next 4 -- hostRoom already fetched the room */
  if (room === undefined) {
    ack(fail('room-not-found', 'this room no longer exists'));
    return;
  }
  if (room.phase !== 'lobby') {
    ack(fail('not-in-lobby', 'settings are locked once the game starts'));
    return;
  }

  const updated = {
    ...room,
    houseRules: parsed.data.houseRules as HouseRules,
    turnTimerSeconds: parsed.data.turnTimerSeconds,
  };
  ctx.store.save(updated);
  ctx.io.to(host.code).emit('room:settingsChanged', { room: toRoomSummary(updated) });
  ack(done);
}

async function handleStart(
  ctx: HandlerContext,
  ack: (r: Result<Record<string, never>>) => void,
): Promise<void> {
  const host = hostRoom(ctx);
  if ('error' in host) {
    ack({ ok: false, error: host.error });
    return;
  }
  const room = ctx.store.get(host.code);
  /* c8 ignore next 4 -- hostRoom already fetched the room */
  if (room === undefined) {
    ack(fail('room-not-found', 'this room no longer exists'));
    return;
  }

  const result = startGame(room, ctx.now());
  if ('error' in result) {
    ack({ ok: false, error: result.error });
    return;
  }
  ctx.store.save(result.room);
  ack(done);
  await broadcastStarted(ctx.io, result.room);
  armTurnTimer(ctx, result.room);
}

async function handleNextRound(
  ctx: HandlerContext,
  ack: (r: Result<Record<string, never>>) => void,
): Promise<void> {
  const host = hostRoom(ctx);
  if ('error' in host) {
    ack({ ok: false, error: host.error });
    return;
  }
  const room = ctx.store.get(host.code);
  /* c8 ignore next 4 -- hostRoom already fetched the room */
  if (room === undefined) {
    ack(fail('room-not-found', 'this room no longer exists'));
    return;
  }

  const result = nextRound(room, ctx.now());
  if ('error' in result) {
    ack({ ok: false, error: result.error });
    return;
  }
  ctx.store.save(result.room);
  ack(done);
  await broadcastStarted(ctx.io, result.room);
  armTurnTimer(ctx, result.room);
}

async function handleAction(
  ctx: HandlerContext,
  payload: unknown,
  ack: (r: Result<Record<string, never>>) => void,
): Promise<void> {
  const parsed = gameActionMessageSchema.safeParse(payload);
  if (!parsed.success) {
    ack(fail('invalid-payload', 'the action payload did not validate'));
    return;
  }
  const { code, seatId } = ctx.socket.data;
  if (code === null || seatId === null) {
    ack(fail('not-a-player', 'only seated players can act'));
    return;
  }
  const room = ctx.store.get(code);
  if (room === undefined) {
    ack(fail('room-not-found', 'this room no longer exists'));
    return;
  }

  const outcome = applyPlayerAction(room, seatId, parsed.data.action, ctx.now());
  if ('error' in outcome) {
    ack({ ok: false, error: outcome.error });
    return;
  }

  ctx.store.save(outcome.room);
  ack(done);
  await broadcastDelta(ctx.io, outcome.room, outcome.events);
  if (outcome.roundEnded !== null) {
    ctx.io.to(code).emit('game:roundEnded', outcome.roundEnded);
  }
  if (outcome.matchEnded !== null) {
    ctx.io.to(code).emit('game:matchEnded', outcome.matchEnded);
  }

  if (outcome.matchEnded !== null || outcome.roundEnded !== null) {
    clearTurnTimer(ctx, code);
  } else {
    armTurnTimer(ctx, outcome.room);
  }
}
