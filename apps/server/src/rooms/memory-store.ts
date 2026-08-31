import type { Room } from './room.js';
import type { RoomStore } from './store.js';

/**
 * A single-process room store. `get` and `list` hand back deep copies so a
 * caller cannot mutate the stored room by accident; the socket handlers read a
 * copy, transition it, and call `save`. A Redis implementation of `RoomStore`
 * behaves the same way for free, since it serializes on every read and write.
 */
export function createInMemoryRoomStore(): RoomStore {
  const rooms = new Map<string, Room>();
  const copy = (room: Room): Room => structuredClone(room);

  return {
    create(room) {
      rooms.set(room.code, copy(room));
    },
    get(code) {
      const room = rooms.get(code);
      return room === undefined ? undefined : copy(room);
    },
    save(room) {
      rooms.set(room.code, copy(room));
    },
    delete(code) {
      rooms.delete(code);
    },
    list() {
      return Array.from(rooms.values(), copy);
    },
    sweep(now, maxIdleMs) {
      const removed: string[] = [];
      for (const [code, room] of rooms) {
        if (now - room.lastActivityAt > maxIdleMs) {
          rooms.delete(code);
          removed.push(code);
        }
      }
      return removed;
    },
  };
}
