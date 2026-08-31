import { isActionCard, isNumberCard, type Card, type CardColor } from '../cards.js';
import { defaultHouseRules, type HouseRules } from '../config.js';
import type { GameState, PendingDrawKind, PlayerState } from '../state.js';

let counter = 0;

/**
 * Build a card from a short spec: `red-7`, `blue-skip`, `green-reverse`,
 * `yellow-draw-two`, `wild`, `wild-draw-four`. Each call gets a unique id so
 * hands never share card identities by accident.
 */
export function card(spec: string): Card {
  counter += 1;
  const uid = `${spec}#${String(counter)}`;

  if (spec === 'wild') {
    return { kind: 'wild', id: uid };
  }
  if (spec === 'wild-draw-four') {
    return { kind: 'wild-draw-four', id: uid };
  }

  const dash = spec.indexOf('-');
  const color = spec.slice(0, dash) as CardColor;
  const rest = spec.slice(dash + 1);

  if (rest === 'skip' || rest === 'reverse' || rest === 'draw-two') {
    return { kind: rest, color, id: uid };
  }
  return { kind: 'number', color, value: Number(rest), id: uid };
}

export function hand(...specs: string[]): Card[] {
  return specs.map(card);
}

export interface GameOptions {
  hands: Card[][];
  top: Card;
  activeColor?: CardColor;
  drawPile?: Card[];
  config?: Partial<HouseRules>;
  currentPlayerIndex?: number;
  direction?: 1 | -1;
  pendingDraw?: number;
  pendingDrawKind?: PendingDrawKind | null;
  pendingWildFour?: GameState['pendingWildFour'];
  pendingColorChoice?: string | null;
  drawnCard?: GameState['drawnCard'];
  unoWindow?: GameState['unoWindow'];
  scores?: Record<string, number>;
  hasCalledUno?: Record<string, boolean>;
}

const colorOf = (c: Card): CardColor | null =>
  isNumberCard(c) || isActionCard(c) ? c.color : null;

export function game(options: GameOptions): GameState {
  const players: PlayerState[] = options.hands.map((cards, i) => ({
    id: `p${String(i)}`,
    name: `Player ${String(i)}`,
    hand: cards,
    hasCalledUno: options.hasCalledUno?.[`p${String(i)}`] ?? false,
  }));

  const scores = options.scores ?? Object.fromEntries(players.map((p) => [p.id, 0]));

  return {
    players,
    currentPlayerIndex: options.currentPlayerIndex ?? 0,
    direction: options.direction ?? 1,
    drawPile: options.drawPile ?? hand('red-0', 'blue-0', 'green-0', 'yellow-0'),
    discardPile: [options.top],
    activeColor: options.activeColor ?? colorOf(options.top),
    pendingDraw: options.pendingDraw ?? 0,
    pendingDrawKind: options.pendingDrawKind ?? null,
    pendingWildFour: options.pendingWildFour ?? null,
    pendingColorChoice: options.pendingColorChoice ?? null,
    drawnCard: options.drawnCard ?? null,
    unoWindow: options.unoWindow ?? null,
    status: 'active',
    roundWinnerId: null,
    scores,
    config: defaultHouseRules(options.config),
    startingPlayerIndex: 0,
  };
}
