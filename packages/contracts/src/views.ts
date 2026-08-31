import type { Card, CardColor, GameStatus, HouseRules, PendingDrawKind } from '@uno/engine';

export type RoomPhase = 'lobby' | 'active' | 'finished';

/** What every client knows about a player other than themselves. */
export interface PublicPlayer {
  id: string;
  name: string;
  handCount: number;
  connected: boolean;
  calledUno: boolean;
}

/** The shared board. The same for every viewer. */
export interface BoardView {
  discardTop: Card;
  activeColor: CardColor | null;
  direction: 1 | -1;
  currentSeatId: string;
  pendingDraw: number;
  pendingDrawKind: PendingDrawKind | null;
  awaitingColorChoiceFrom: string | null;
  scores: Record<string, number>;
  status: GameStatus;
  roundWinnerId: string | null;
}

export interface SelfView {
  id: string;
  hand: Card[];
  hasCalledUno: boolean;
  /** A card drawn this turn that is still yours to play or keep. */
  drawnCard: { cardId: string; playable: boolean } | null;
}

export interface PlayerView {
  kind: 'player';
  self: SelfView;
  players: PublicPlayer[];
  /** Null while the room is still in the lobby. */
  board: BoardView | null;
}

export interface SpectatorView {
  kind: 'spectator';
  players: PublicPlayer[];
  board: BoardView | null;
}

export type AnyView = PlayerView | SpectatorView;

export interface RoomSummary {
  code: string;
  phase: RoomPhase;
  hostSeatId: string;
  seatCount: number;
  spectatorCount: number;
  houseRules: HouseRules;
  turnTimerSeconds: number | null;
}
