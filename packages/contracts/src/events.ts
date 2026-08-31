import type { GameEvent } from '@uno/engine';

import type { ProtocolError, Result } from './errors.js';
import type {
  GameActionInput,
  RoomCreateInput,
  RoomJoinInput,
  RoomReconnectInput,
  RoomUpdateSettingsInput,
} from './schemas.js';
import type { AnyView, PlayerView, RoomSummary, SpectatorView } from './views.js';

type Ack<T> = (result: Result<T>) => void;

export type JoinResult =
  { seat: true; playerToken: string; view: PlayerView } | { seat: false; view: SpectatorView };

export interface ClientToServerEvents {
  'room:create': (
    payload: RoomCreateInput,
    ack: Ack<{ code: string; playerToken: string; view: PlayerView }>,
  ) => void;
  'room:join': (payload: RoomJoinInput, ack: Ack<JoinResult>) => void;
  'room:reconnect': (payload: RoomReconnectInput, ack: Ack<{ view: AnyView }>) => void;
  'room:leave': (ack: Ack<Record<string, never>>) => void;
  'room:updateSettings': (
    payload: RoomUpdateSettingsInput,
    ack: Ack<Record<string, never>>,
  ) => void;
  'room:start': (ack: Ack<Record<string, never>>) => void;
  'room:nextRound': (ack: Ack<Record<string, never>>) => void;
  'game:action': (payload: { action: GameActionInput }, ack: Ack<Record<string, never>>) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (payload: { view: AnyView; room: RoomSummary }) => void;
  'room:presence': (payload: { seatId: string; connected: boolean }) => void;
  'room:playerJoined': (payload: { seatId: string; name: string }) => void;
  'room:playerLeft': (payload: { seatId: string; name: string }) => void;
  'room:settingsChanged': (payload: { room: RoomSummary }) => void;
  'game:started': (payload: { view: AnyView }) => void;
  'game:delta': (payload: {
    view: AnyView;
    events: GameEvent[];
    /** Set to the seat id when the server played this move on a timeout. */
    autoPlayed?: string;
  }) => void;
  'game:roundEnded': (payload: { winnerId: string; scores: Record<string, number> }) => void;
  'game:matchEnded': (payload: { winnerId: string; scores: Record<string, number> }) => void;
  'turn:timer': (payload: { seatId: string; endsAt: number }) => void;
  error: (payload: ProtocolError) => void;
}

export interface SocketData {
  code: string | null;
  seatId: string | null;
  spectatorId: string | null;
}
