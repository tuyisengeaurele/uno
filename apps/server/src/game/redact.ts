import { currentPlayer, type GameState } from '@uno/engine';
import type {
  BoardView,
  PlayerView,
  PublicPlayer,
  RoomSummary,
  SpectatorView,
} from '@uno/contracts';

import { seatById, type Room } from '../rooms/room.js';

function requireDiscardTop(game: GameState): BoardView['discardTop'] {
  const top = game.discardPile.at(-1);
  /* c8 ignore next 3 -- an active game always has a discard pile */
  if (top === undefined) {
    throw new Error('active game has an empty discard pile');
  }
  return top;
}

export function toRoomSummary(room: Room): RoomSummary {
  return {
    code: room.code,
    phase: room.phase,
    hostSeatId: room.hostSeatId,
    seatCount: room.seats.length,
    spectatorCount: room.spectators.length,
    houseRules: room.houseRules,
    turnTimerSeconds: room.turnTimerSeconds,
  };
}

export function toPublicPlayers(room: Room): PublicPlayer[] {
  if (room.game === null) {
    return room.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      handCount: 0,
      connected: seat.connected,
      calledUno: false,
    }));
  }

  return room.game.players.map((player) => ({
    id: player.id,
    name: player.name,
    handCount: player.hand.length,
    /* c8 ignore next -- every player in an active game has a seat */
    connected: seatById(room, player.id)?.connected ?? false,
    calledUno: player.hasCalledUno,
  }));
}

export function toBoardView(room: Room): BoardView | null {
  const game = room.game;
  if (game === null) {
    return null;
  }
  return {
    discardTop: requireDiscardTop(game),
    activeColor: game.activeColor,
    direction: game.direction,
    currentSeatId: currentPlayer(game).id,
    pendingDraw: game.pendingDraw,
    pendingDrawKind: game.pendingDrawKind,
    awaitingColorChoiceFrom: game.pendingColorChoice,
    scores: game.scores,
    status: game.status,
    roundWinnerId: game.roundWinnerId,
  };
}

export function toPlayerView(room: Room, seatId: string): PlayerView {
  const mine = room.game?.players.find((player) => player.id === seatId);
  return {
    kind: 'player',
    self: {
      id: seatId,
      hand: mine?.hand ?? [],
      hasCalledUno: mine?.hasCalledUno ?? false,
    },
    players: toPublicPlayers(room),
    board: toBoardView(room),
  };
}

export function toSpectatorView(room: Room): SpectatorView {
  return {
    kind: 'spectator',
    players: toPublicPlayers(room),
    board: toBoardView(room),
  };
}
