import { randomUUID } from 'node:crypto';

import type { GameState, HouseRules } from '@uno/engine';

export type RoomPhase = 'lobby' | 'active' | 'finished';

export const MAX_SEATS = 10;
export const MIN_SEATS = 2;
export const DEFAULT_TURN_TIMER_SECONDS = 45;

export interface Seat {
  id: string;
  name: string;
  connected: boolean;
  disconnectedAt: number | null;
}

export interface Spectator {
  id: string;
  name: string;
}

export interface Room {
  code: string;
  hostSeatId: string;
  phase: RoomPhase;
  seats: Seat[];
  spectators: Spectator[];
  houseRules: HouseRules;
  turnTimerSeconds: number | null;
  seed: number;
  rngState: number;
  game: GameState | null;
  createdAt: number;
  lastActivityAt: number;
}

export interface CreateRoomInput {
  code: string;
  hostName: string;
  houseRules: HouseRules;
  turnTimerSeconds: number | null;
  seed: number;
  now: number;
}

export function createRoom(input: CreateRoomInput): Room {
  const host: Seat = {
    id: randomUUID(),
    name: input.hostName,
    connected: true,
    disconnectedAt: null,
  };
  return {
    code: input.code,
    hostSeatId: host.id,
    phase: 'lobby',
    seats: [host],
    spectators: [],
    houseRules: input.houseRules,
    turnTimerSeconds: input.turnTimerSeconds,
    seed: input.seed,
    rngState: input.seed >>> 0,
    game: null,
    createdAt: input.now,
    lastActivityAt: input.now,
  };
}

export type AddSeatResult =
  { added: true; room: Room; seat: Seat } | { added: false; reason: 'closed' | 'full' };

export function addSeat(room: Room, name: string, now: number): AddSeatResult {
  if (room.phase !== 'lobby') {
    return { added: false, reason: 'closed' };
  }
  if (room.seats.length >= MAX_SEATS) {
    return { added: false, reason: 'full' };
  }
  const seat: Seat = { id: randomUUID(), name, connected: true, disconnectedAt: null };
  return {
    added: true,
    room: { ...room, seats: [...room.seats, seat], lastActivityAt: now },
    seat,
  };
}

export function addSpectator(room: Room, name: string): { room: Room; spectator: Spectator } {
  const spectator: Spectator = { id: randomUUID(), name };
  return { room: { ...room, spectators: [...room.spectators, spectator] }, spectator };
}

export function removeSpectator(room: Room, spectatorId: string): Room {
  return { ...room, spectators: room.spectators.filter((s) => s.id !== spectatorId) };
}

export function markSeatConnected(
  room: Room,
  seatId: string,
  connected: boolean,
  now: number,
): Room {
  return {
    ...room,
    seats: room.seats.map((seat) =>
      seat.id === seatId ? { ...seat, connected, disconnectedAt: connected ? null : now } : seat,
    ),
  };
}

/** Drop a seat. If the host left and seats remain, the next seat becomes host. */
export function removeSeat(room: Room, seatId: string): Room {
  const seats = room.seats.filter((seat) => seat.id !== seatId);
  const [next] = seats;
  const hostSeatId = room.hostSeatId === seatId && next ? next.id : room.hostSeatId;
  return { ...room, seats, hostSeatId };
}

export function canStart(
  room: Room,
): { ok: true } | { ok: false; code: 'not-in-lobby' | 'too-few-players' } {
  if (room.phase !== 'lobby') {
    return { ok: false, code: 'not-in-lobby' };
  }
  if (room.seats.length < MIN_SEATS) {
    return { ok: false, code: 'too-few-players' };
  }
  return { ok: true };
}

export function seatById(room: Room, seatId: string): Seat | undefined {
  return room.seats.find((seat) => seat.id === seatId);
}
