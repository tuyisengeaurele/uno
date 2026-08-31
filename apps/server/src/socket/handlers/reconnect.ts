import { type Result, roomReconnectSchema } from '@uno/contracts';

import { protocolError, type ProtocolError } from '../../errors.js';
import { toPlayerView, toRoomSummary } from '../../game/redact.js';
import { markSeatConnected, seatById } from '../../rooms/room.js';
import { clientIp, type HandlerContext } from '../context.js';

const fail = (code: ProtocolError['code'], message: string): Result<never> => ({
  ok: false,
  error: protocolError(code, message),
});

export function registerReconnectHandler(ctx: HandlerContext): void {
  ctx.socket.on('room:reconnect', (payload, ack) => {
    void handleReconnect(ctx, payload, ack);
  });
}

async function handleReconnect(
  ctx: HandlerContext,
  payload: unknown,
  ack: (r: Result<{ view: ReturnType<typeof toPlayerView> }>) => void,
): Promise<void> {
  if (!ctx.rateLimiters.reconnect.tryConsume(clientIp(ctx.socket), ctx.now())) {
    ack(fail('rate-limited', 'too many reconnect attempts, wait a moment'));
    return;
  }

  const parsed = roomReconnectSchema.safeParse(payload);
  if (!parsed.success) {
    ack(fail('invalid-payload', 'the reconnect payload did not validate'));
    return;
  }

  const ref = ctx.tokens.resolve(parsed.data.playerToken);
  if (ref?.code !== parsed.data.code) {
    ack(fail('bad-token', 'that reconnect token is not valid for this room'));
    return;
  }

  const room = ctx.store.get(ref.code);
  if (room === undefined) {
    ack(fail('room-not-found', 'this room no longer exists'));
    return;
  }
  if (seatById(room, ref.seatId) === undefined) {
    ack(fail('bad-token', 'your seat is no longer in this room'));
    return;
  }

  const updated = markSeatConnected(room, ref.seatId, true, ctx.now());
  ctx.store.save(updated);
  ctx.socket.data = { code: ref.code, seatId: ref.seatId, spectatorId: null };
  await ctx.socket.join(ref.code);

  const view = toPlayerView(updated, ref.seatId);
  ack({ ok: true, data: { view } });
  ctx.socket.emit('room:snapshot', { view, room: toRoomSummary(updated) });
  ctx.socket.to(ref.code).emit('room:presence', { seatId: ref.seatId, connected: true });
}
