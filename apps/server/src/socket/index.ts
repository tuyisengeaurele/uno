import type { HandlerContext, SocketDeps } from './context.js';
import { registerGameHandlers } from './handlers/game.js';
import { registerRoomHandlers } from './handlers/rooms.js';

export function attachSocketServer(deps: SocketDeps): void {
  deps.io.on('connection', (socket) => {
    socket.data = { code: null, seatId: null, spectatorId: null };
    const ctx: HandlerContext = { ...deps, socket };
    registerRoomHandlers(ctx);
    registerGameHandlers(ctx);
  });
}
