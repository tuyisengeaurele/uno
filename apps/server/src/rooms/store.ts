import type { Room } from './room.js';

export interface RoomStore {
  create(room: Room): void;
  get(code: string): Room | undefined;
  save(room: Room): void;
  delete(code: string): void;
  list(): Room[];
  /** Delete rooms idle longer than `maxIdleMs` and return their codes. */
  sweep(now: number, maxIdleMs: number): string[];
}
