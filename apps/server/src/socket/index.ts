import type { HandlerContext, SocketDeps } from './context.js';
import { registerGameHandlers } from './handlers/game.js';
import { registerReconnectHandler } from './handlers/reconnect.js';
import { registerRoomHandlers } from './handlers/rooms.js';
import { handleDisconnect } from './presence.js';

export function attachSocketServer(deps: SocketDeps): void {
  deps.io.on('connection', (socket) => {
    socket.data = { code: null, seatId: null, spectatorId: null };
    const ctx: HandlerContext = { ...deps, socket };

    registerRoomHandlers(ctx);
    registerGameHandlers(ctx);
    registerReconnectHandler(ctx);

    socket.on('disconnect', () => {
      handleDisconnect(ctx);
    });
  });
}
