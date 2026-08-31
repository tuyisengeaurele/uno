import { markSeatConnected, removeSpectator } from '../rooms/room.js';
import type { HandlerContext } from './context.js';

/**
 * A socket dropped. Keep the seat (it may reconnect, and during a game it is
 * auto-played), just mark it offline and tell the room. Spectators are removed.
 */
export function handleDisconnect(ctx: HandlerContext): void {
  const { code, seatId, spectatorId } = ctx.socket.data;
  if (code === null) {
    return;
  }
  const room = ctx.store.get(code);
  if (room === undefined) {
    return;
  }

  if (seatId !== null) {
    ctx.store.save(markSeatConnected(room, seatId, false, ctx.now()));
    ctx.socket.to(code).emit('room:presence', { seatId, connected: false });
  } else if (spectatorId !== null) {
    ctx.store.save(removeSpectator(room, spectatorId));
    ctx.socket.to(code).emit('room:playerLeft', { seatId: spectatorId, name: '' });
  }
}
