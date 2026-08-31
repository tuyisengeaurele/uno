import { randomInt } from 'node:crypto';

import { defaultHouseRules, type HouseRules } from '@uno/engine';
import { type Result, roomCreateSchema, roomJoinSchema } from '@uno/contracts';

import { toPlayerView, toSpectatorView } from '../../game/redact.js';
import {
  addSeat,
  addSpectator,
  createRoom,
  DEFAULT_TURN_TIMER_SECONDS,
  removeSeat,
  removeSpectator,
  seatById,
} from '../../rooms/room.js';
import { uniqueRoomCode } from '../../rooms/codes.js';
import { protocolError, type ProtocolError } from '../../errors.js';
import { clientIp, type HandlerContext } from '../context.js';

const fail = (code: ProtocolError['code'], message: string): Result<never> => ({
  ok: false,
  error: protocolError(code, message),
});

export function registerRoomHandlers(ctx: HandlerContext): void {
  ctx.socket.on('room:create', (payload, ack) => {
    void handleCreate(ctx, payload, ack);
  });
  ctx.socket.on('room:join', (payload, ack) => {
    void handleJoin(ctx, payload, ack);
  });
  ctx.socket.on('room:leave', (ack) => {
    void handleLeave(ctx, ack);
  });
}

async function handleCreate(
  ctx: HandlerContext,
  payload: unknown,
  ack: (
    r: Result<{ code: string; playerToken: string; view: ReturnType<typeof toPlayerView> }>,
  ) => void,
): Promise<void> {
  const parsed = roomCreateSchema.safeParse(payload);
  if (!parsed.success) {
    ack(fail('invalid-payload', 'the create payload did not validate'));
    return;
  }
  if (!ctx.rateLimiters.create.tryConsume(clientIp(ctx.socket), ctx.now())) {
    ack(fail('rate-limited', 'too many rooms created from this address, try again shortly'));
    return;
  }

  const code = uniqueRoomCode((candidate) => ctx.store.get(candidate) !== undefined);
  const room = createRoom({
    code,
    hostName: parsed.data.name,
    houseRules: defaultHouseRules(parsed.data.houseRules as Partial<HouseRules> | undefined),
    turnTimerSeconds:
      parsed.data.turnTimerSeconds === undefined
        ? DEFAULT_TURN_TIMER_SECONDS
        : parsed.data.turnTimerSeconds,
    seed: randomInt(2 ** 31),
    now: ctx.now(),
  });
  ctx.store.create(room);

  const host = room.seats[0];
  /* c8 ignore next 3 -- a freshly created room always has the host seat */
  if (host === undefined) {
    ack(fail('invalid-payload', 'room was created without a host seat'));
    return;
  }

  const playerToken = ctx.tokens.issue(code, host.id);
  ctx.socket.data = { code, seatId: host.id, spectatorId: null };
  await ctx.socket.join(code);

  ack({ ok: true, data: { code, playerToken, view: toPlayerView(room, host.id) } });
}

async function handleJoin(
  ctx: HandlerContext,
  payload: unknown,
  ack: (
    r: Result<
      | { seat: true; playerToken: string; view: ReturnType<typeof toPlayerView> }
      | { seat: false; view: ReturnType<typeof toSpectatorView> }
    >,
  ) => void,
): Promise<void> {
  const parsed = roomJoinSchema.safeParse(payload);
  if (!parsed.success) {
    ack(fail('invalid-payload', 'the join payload did not validate'));
    return;
  }

  const room = ctx.store.get(parsed.data.code);
  if (room === undefined) {
    ack(fail('room-not-found', 'no room with that code'));
    return;
  }

  if (room.phase === 'lobby') {
    const result = addSeat(room, parsed.data.name, ctx.now());
    if (result.added) {
      ctx.store.save(result.room);
      const playerToken = ctx.tokens.issue(room.code, result.seat.id);
      ctx.socket.data = { code: room.code, seatId: result.seat.id, spectatorId: null };
      await ctx.socket.join(room.code);
      ack({
        ok: true,
        data: { seat: true, playerToken, view: toPlayerView(result.room, result.seat.id) },
      });
      ctx.socket
        .to(room.code)
        .emit('room:playerJoined', { seatId: result.seat.id, name: result.seat.name });
      return;
    }
  }

  const { room: withSpectator, spectator } = addSpectator(room, parsed.data.name);
  ctx.store.save(withSpectator);
  ctx.socket.data = { code: room.code, seatId: null, spectatorId: spectator.id };
  await ctx.socket.join(room.code);
  ack({ ok: true, data: { seat: false, view: toSpectatorView(withSpectator) } });
}

async function handleLeave(
  ctx: HandlerContext,
  ack: (r: Result<Record<string, never>>) => void,
): Promise<void> {
  const { code, seatId, spectatorId } = ctx.socket.data;
  if (code !== null) {
    const room = ctx.store.get(code);
    if (room !== undefined && seatId !== null && room.phase === 'lobby') {
      const after = removeSeat(room, seatId);
      const seatName = seatById(room, seatId)?.name ?? '';
      if (after.seats.length === 0) {
        ctx.store.delete(code);
        ctx.tokens.revokeRoom(code);
      } else {
        ctx.store.save(after);
        ctx.socket.to(code).emit('room:playerLeft', { seatId, name: seatName });
      }
    } else if (room !== undefined && spectatorId !== null) {
      ctx.store.save(removeSpectator(room, spectatorId));
    }
    await ctx.socket.leave(code);
  }

  ctx.socket.data = { code: null, seatId: null, spectatorId: null };
  ack({ ok: true, data: {} });
}
