import type { GameAction } from './actions.js';
import { canPlayOn, isWild, type Card, type CardColor } from './cards.js';
import type { HouseRules } from './config.js';
import { drawCards } from './deck.js';
import { gameError, type GameError } from './errors.js';
import type { GameEvent } from './events.js';
import type { Rng } from './rng.js';
import {
  currentPlayer,
  playerById,
  type GameState,
  type PendingDrawKind,
  type PlayerState,
} from './state.js';
import { tallyRound } from './scoring.js';
import { nextIndex, reverse, type Direction } from './turn.js';

export interface EngineContext {
  readonly rng: Rng;
}

export type ActionResult =
  | { readonly ok: true; readonly state: GameState; readonly events: GameEvent[] }
  | { readonly ok: false; readonly error: GameError };

const succeed = (state: GameState, events: GameEvent[]): ActionResult => ({
  ok: true,
  state,
  events,
});
const reject = (error: GameError): ActionResult => ({ ok: false, error });

export function applyAction(
  state: GameState,
  action: GameAction,
  ctx: EngineContext,
): ActionResult {
  if (state.status !== 'active') {
    return reject(gameError('game-not-active', 'the round has already ended'));
  }

  switch (action.type) {
    case 'choose-color':
      return applyChooseColor(state, action);
    case 'play-card':
      return applyPlay(state, action, { fromDraw: false });
    case 'play-drawn':
      return applyPlay(state, action, { fromDraw: true });
    case 'draw':
      return applyDraw(state, action, ctx);
    case 'pass':
      return applyPass(state, action);
    case 'call-uno':
      return applyCallUno(state, action);
    case 'catch-unfair-uno':
      return applyCatchUno(state, action, ctx);
    case 'challenge-wild-four':
      return applyChallenge(state, action, ctx);
  }
}

// --- shared helpers ---------------------------------------------------------

function replacePlayer(
  players: readonly PlayerState[],
  id: string,
  update: (player: PlayerState) => PlayerState,
): PlayerState[] {
  return players.map((player) => (player.id === id ? update(player) : player));
}

function requireTop(state: GameState): Card {
  const top = state.discardPile.at(-1);
  /* c8 ignore next 3 -- the discard pile is never empty once a round is running */
  if (top === undefined) {
    throw new Error('discard pile is empty');
  }
  return top;
}

function advance(state: GameState, direction: Direction, step: number): number {
  return nextIndex(state.currentPlayerIndex, direction, state.players.length, step);
}

/** Whether `card` may be added to the pending draw stack under the house rules. */
function canStack(card: Card, pendingKind: PendingDrawKind | null, rules: HouseRules): boolean {
  if (pendingKind === null) {
    return false;
  }
  if (card.kind === 'draw-two') {
    return (
      (rules.stacking === 'draw-two' || rules.stacking === 'both') && pendingKind === 'draw-two'
    );
  }
  if (card.kind === 'wild-draw-four') {
    return rules.stacking === 'draw-four' || rules.stacking === 'both';
  }
  return false;
}

function holdsColor(hand: readonly Card[], color: CardColor): boolean {
  return hand.some((card) => !isWild(card) && card.color === color);
}

function reshuffleHappened(before: GameState, afterDiscard: readonly Card[]): boolean {
  return afterDiscard.length !== before.discardPile.length;
}

// --- choose-color ---------------------------------------------------------

function applyChooseColor(
  state: GameState,
  action: Extract<GameAction, { type: 'choose-color' }>,
): ActionResult {
  if (state.pendingColorChoice === null) {
    return reject(gameError('color-not-expected', 'no colour choice is pending'));
  }
  if (state.pendingColorChoice !== action.playerId) {
    return reject(gameError('not-your-turn', 'another player owes the colour choice'));
  }

  return succeed({ ...state, activeColor: action.color, pendingColorChoice: null }, [
    { type: 'color-chosen', playerId: action.playerId, color: action.color },
  ]);
}

// --- play-card / play-drawn ----------------------------------------------

function applyPlay(
  state: GameState,
  action: Extract<GameAction, { type: 'play-card' | 'play-drawn' }>,
  opts: { fromDraw: boolean },
): ActionResult {
  const player = currentPlayer(state);
  if (player.id !== action.playerId) {
    return reject(gameError('not-your-turn', 'it is not your turn'));
  }
  if (state.pendingColorChoice !== null) {
    return reject(gameError('resolve-color-choice', 'choose a colour first'));
  }

  if (opts.fromDraw) {
    const drawn = state.drawnCard;
    if (drawn === null) {
      return reject(gameError('card-not-drawn', 'you have not drawn a card this turn'));
    }
    if (drawn.playerId !== action.playerId || drawn.cardId !== action.cardId) {
      return reject(gameError('card-not-drawn', 'you can only play the card you just drew'));
    }
  } else if (state.drawnCard !== null) {
    return reject(gameError('must-answer-draw', 'play the card you drew or pass'));
  }

  const card = player.hand.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return reject(gameError('card-not-in-hand', 'that card is not in your hand'));
  }

  if (state.pendingDraw > 0) {
    if (!canStack(card, state.pendingDrawKind, state.config)) {
      return reject(
        gameError('must-answer-draw', `draw the ${String(state.pendingDraw)} cards you are facing`),
      );
    }
  } else {
    const activeColor = state.activeColor;
    /* c8 ignore next 3 -- active colour is set before any play is possible */
    if (activeColor === null) {
      return reject(gameError('resolve-color-choice', 'choose a colour first'));
    }
    if (!canPlayOn(card, requireTop(state), activeColor)) {
      return reject(gameError('illegal-play', 'that card does not match the pile'));
    }
  }

  if (isWild(card)) {
    if (action.chosenColor === undefined) {
      return reject(gameError('color-required', 'choose a colour for the wild'));
    }
  } else if (action.chosenColor !== undefined) {
    return reject(gameError('color-not-expected', 'only wild cards take a colour'));
  }

  return resolvePlay(state, player, card, action.chosenColor);
}

function resolvePlay(
  state: GameState,
  player: PlayerState,
  card: Card,
  chosenColor: CardColor | undefined,
): ActionResult {
  const events: GameEvent[] = [{ type: 'card-played', playerId: player.id, card }];
  const handAfter = removeCard(player.hand, card.id);
  const players = replacePlayer(state.players, player.id, (p) => ({ ...p, hand: handAfter }));
  const playerCount = state.players.length;

  const activeColor: CardColor =
    isWild(card) && chosenColor !== undefined ? chosenColor : asColor(card);
  if (isWild(card) && chosenColor !== undefined) {
    events.push({ type: 'color-chosen', playerId: player.id, color: chosenColor });
  }

  let direction = state.direction;
  let pendingDraw = state.pendingDraw;
  let pendingDrawKind = state.pendingDrawKind;
  let pendingWildFour = state.pendingWildFour;
  let nextSeat = advance(state, direction, 1);

  switch (card.kind) {
    case 'number':
    case 'wild':
      break;

    case 'skip': {
      const skipped = state.players[advance(state, direction, 1)];
      /* c8 ignore next 3 -- the seat one step away always exists */
      if (skipped !== undefined) {
        events.push({ type: 'turn-skipped', playerId: skipped.id });
      }
      nextSeat = advance(state, direction, 2);
      break;
    }

    case 'reverse':
      direction = reverse(direction);
      events.push({ type: 'direction-reversed', direction });
      nextSeat =
        playerCount === 2
          ? state.currentPlayerIndex
          : nextIndex(state.currentPlayerIndex, direction, playerCount, 1);
      break;

    case 'draw-two':
      pendingDraw += 2;
      pendingDrawKind = 'draw-two';
      break;

    case 'wild-draw-four':
      pendingDraw += 4;
      pendingDrawKind = 'draw-four';
      pendingWildFour =
        state.config.wildFourChallenge && state.activeColor !== null
          ? {
              playedBy: player.id,
              colorBefore: state.activeColor,
              hadColorMatch: holdsColor(handAfter, state.activeColor),
            }
          : null;
      break;
  }

  const winnerId = handAfter.length === 0 ? player.id : null;

  // Any turn-advancing action ends the previous UNO window: either the vulnerable
  // player has acted again, or the opponent who could have caught them moved on.
  let unoWindow: GameState['unoWindow'] = null;
  if (winnerId === null && handAfter.length === 1 && !player.hasCalledUno) {
    unoWindow = { playerId: player.id };
  }

  if (winnerId === null) {
    return succeed(
      {
        ...state,
        players,
        discardPile: [...state.discardPile, card],
        activeColor,
        direction,
        currentPlayerIndex: nextSeat,
        pendingDraw,
        pendingDrawKind,
        pendingWildFour,
        drawnCard: null,
        unoWindow,
      },
      events,
    );
  }

  const scores = tallyRound(players, winnerId, state.scores);
  const matchOver = (scores[winnerId] ?? 0) >= state.config.targetScore;
  events.push(
    matchOver
      ? { type: 'match-ended', winnerId, scores }
      : { type: 'round-ended', winnerId, scores },
  );

  return succeed(
    {
      ...state,
      players,
      discardPile: [...state.discardPile, card],
      activeColor,
      direction,
      pendingDraw: 0,
      pendingDrawKind: null,
      pendingWildFour: null,
      drawnCard: null,
      unoWindow: null,
      scores,
      status: matchOver ? 'match-over' : 'round-over',
      roundWinnerId: winnerId,
    },
    events,
  );
}

function asColor(card: Card): CardColor {
  /* c8 ignore next 3 -- callers pass a coloured card or a wild with a chosen colour */
  if (isWild(card)) {
    throw new Error('wild card has no intrinsic colour');
  }
  return card.color;
}

function removeCard(hand: readonly Card[], cardId: string): Card[] {
  const index = hand.findIndex((c) => c.id === cardId);
  /* c8 ignore next 3 -- callers confirm the card is in the hand */
  if (index < 0) {
    return [...hand];
  }
  return [...hand.slice(0, index), ...hand.slice(index + 1)];
}

// --- draw ---------------------------------------------------------------

function applyDraw(
  state: GameState,
  action: Extract<GameAction, { type: 'draw' }>,
  ctx: EngineContext,
): ActionResult {
  const player = currentPlayer(state);
  if (player.id !== action.playerId) {
    return reject(gameError('not-your-turn', 'it is not your turn'));
  }
  if (state.pendingColorChoice !== null) {
    return reject(gameError('resolve-color-choice', 'choose a colour first'));
  }
  if (state.drawnCard !== null) {
    return reject(gameError('draw-first', 'you have already drawn this turn'));
  }

  return state.pendingDraw > 0
    ? servePendingDraw(state, player, ctx)
    : drawForTurn(state, player, ctx);
}

function servePendingDraw(state: GameState, player: PlayerState, ctx: EngineContext): ActionResult {
  const count = state.pendingDraw;
  const { drawn, drawPile, discardPile } = drawCards(
    state.drawPile,
    state.discardPile,
    count,
    ctx.rng,
  );

  const players = replacePlayer(state.players, player.id, (p) => ({
    ...p,
    hand: [...p.hand, ...drawn],
    hasCalledUno: false,
  }));

  return succeed(
    {
      ...state,
      players,
      drawPile,
      discardPile,
      pendingDraw: 0,
      pendingDrawKind: null,
      pendingWildFour: null,
      drawnCard: null,
      unoWindow: null,
      currentPlayerIndex: advance(state, state.direction, 1),
    },
    [
      {
        type: 'player-drew',
        playerId: player.id,
        count: drawn.length,
        reshuffled: reshuffleHappened(state, discardPile),
      },
      { type: 'draw-penalty-served', playerId: player.id, count: drawn.length },
    ],
  );
}

function drawForTurn(state: GameState, player: PlayerState, ctx: EngineContext): ActionResult {
  const top = requireTop(state);
  const activeColor = state.activeColor;
  /* c8 ignore next 3 -- active colour is set once the first card resolves */
  if (activeColor === null) {
    return reject(gameError('resolve-color-choice', 'choose a colour first'));
  }

  let pile = state.drawPile;
  let discard = state.discardPile;
  const collected: Card[] = [];

  const pull = (): Card | undefined => {
    const result = drawCards(pile, discard, 1, ctx.rng);
    pile = result.drawPile;
    discard = result.discardPile;
    return result.drawn.at(0);
  };

  let next = pull();
  while (next !== undefined) {
    collected.push(next);
    const keepGoing = state.config.drawUntilPlayable && !canPlayOn(next, top, activeColor);
    next = keepGoing ? pull() : undefined;
  }

  const lastCard = collected.at(-1);
  const playableDrawn =
    lastCard !== undefined && canPlayOn(lastCard, top, activeColor) ? lastCard : null;

  const players = replacePlayer(state.players, player.id, (p) => ({
    ...p,
    hand: [...p.hand, ...collected],
    hasCalledUno: false,
  }));

  const drewEvent: GameEvent = {
    type: 'player-drew',
    playerId: player.id,
    count: collected.length,
    reshuffled: reshuffleHappened(state, discard),
  };

  if (state.config.playDrawnCard && playableDrawn !== null) {
    return succeed(
      {
        ...state,
        players,
        drawPile: pile,
        discardPile: discard,
        drawnCard: { playerId: player.id, cardId: playableDrawn.id, playable: true },
        unoWindow: null,
      },
      [drewEvent],
    );
  }

  return succeed(
    {
      ...state,
      players,
      drawPile: pile,
      discardPile: discard,
      drawnCard: null,
      unoWindow: null,
      currentPlayerIndex: advance(state, state.direction, 1),
    },
    [drewEvent],
  );
}

// --- pass -------------------------------------------------------------

function applyPass(state: GameState, action: Extract<GameAction, { type: 'pass' }>): ActionResult {
  const player = currentPlayer(state);
  if (player.id !== action.playerId) {
    return reject(gameError('not-your-turn', 'it is not your turn'));
  }
  if (state.drawnCard?.playerId !== action.playerId) {
    return reject(gameError('nothing-to-pass', 'draw a card before passing'));
  }

  return succeed(
    {
      ...state,
      drawnCard: null,
      unoWindow: null,
      currentPlayerIndex: advance(state, state.direction, 1),
    },
    [],
  );
}

// --- call-uno / catch-unfair-uno --------------------------------------

function applyCallUno(
  state: GameState,
  action: Extract<GameAction, { type: 'call-uno' }>,
): ActionResult {
  const player = playerById(state, action.playerId);
  if (player === undefined) {
    return reject(gameError('unknown-player', 'no such player'));
  }
  if (player.hand.length === 0 || player.hand.length > 2) {
    return reject(gameError('uno-not-available', 'you can only call UNO at one or two cards'));
  }

  const players = replacePlayer(state.players, player.id, (p) => ({ ...p, hasCalledUno: true }));
  const unoWindow = state.unoWindow?.playerId === player.id ? null : state.unoWindow;

  return succeed({ ...state, players, unoWindow }, [{ type: 'uno-called', playerId: player.id }]);
}

function applyCatchUno(
  state: GameState,
  action: Extract<GameAction, { type: 'catch-unfair-uno' }>,
  ctx: EngineContext,
): ActionResult {
  if (playerById(state, action.accuserId) === undefined) {
    return reject(gameError('unknown-player', 'no such accuser'));
  }
  const target = playerById(state, action.targetId);
  if (target === undefined) {
    return reject(gameError('unknown-player', 'no such target'));
  }
  if (state.unoWindow?.playerId !== action.targetId || target.hand.length !== 1) {
    return reject(gameError('no-uno-to-catch', 'that player is not open to a UNO catch'));
  }

  const penalty = state.config.unoPenalty;
  const { drawn, drawPile, discardPile } = drawCards(
    state.drawPile,
    state.discardPile,
    penalty,
    ctx.rng,
  );
  const players = replacePlayer(state.players, target.id, (p) => ({
    ...p,
    hand: [...p.hand, ...drawn],
    hasCalledUno: false,
  }));

  return succeed({ ...state, players, drawPile, discardPile, unoWindow: null }, [
    {
      type: 'uno-penalty',
      playerId: target.id,
      accuserId: action.accuserId,
      count: drawn.length,
    },
  ]);
}

// --- challenge-wild-four ---------------------------------------------

function applyChallenge(
  state: GameState,
  action: Extract<GameAction, { type: 'challenge-wild-four' }>,
  ctx: EngineContext,
): ActionResult {
  const pending = state.pendingWildFour;
  if (pending === null || state.pendingDraw === 0) {
    return reject(gameError('challenge-not-available', 'there is no wild draw four to challenge'));
  }
  const challenger = currentPlayer(state);
  if (challenger.id !== action.challengerId) {
    return reject(
      gameError('challenge-not-available', 'only the player facing the card may challenge'),
    );
  }
  if (state.drawnCard !== null) {
    return reject(gameError('challenge-not-available', 'you have already responded'));
  }

  const target = playerById(state, pending.playedBy);
  /* c8 ignore next 3 -- the player who played the card is still in the game */
  if (target === undefined) {
    throw new Error('challenged player is not in the game');
  }

  const upheld = pending.hadColorMatch;
  const cleared = {
    pendingDraw: 0,
    pendingDrawKind: null,
    pendingWildFour: null,
  } satisfies Partial<GameState>;

  if (upheld) {
    const penalty = state.pendingDraw;
    const { drawn, drawPile, discardPile } = drawCards(
      state.drawPile,
      state.discardPile,
      penalty,
      ctx.rng,
    );
    const players = replacePlayer(state.players, target.id, (p) => ({
      ...p,
      hand: [...p.hand, ...drawn],
    }));
    return succeed({ ...state, ...cleared, players, drawPile, discardPile }, [
      {
        type: 'challenge-resolved',
        challengerId: challenger.id,
        targetId: target.id,
        upheld: true,
        penalty: drawn.length,
      },
    ]);
  }

  const penalty = state.pendingDraw + 2;
  const { drawn, drawPile, discardPile } = drawCards(
    state.drawPile,
    state.discardPile,
    penalty,
    ctx.rng,
  );
  const players = replacePlayer(state.players, challenger.id, (p) => ({
    ...p,
    hand: [...p.hand, ...drawn],
    hasCalledUno: false,
  }));
  return succeed(
    {
      ...state,
      ...cleared,
      players,
      drawPile,
      discardPile,
      currentPlayerIndex: advance(state, state.direction, 1),
    },
    [
      {
        type: 'challenge-resolved',
        challengerId: challenger.id,
        targetId: target.id,
        upheld: false,
        penalty: drawn.length,
      },
    ],
  );
}
