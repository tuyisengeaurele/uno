export type Direction = 1 | -1;

/**
 * The seat `step` places from `current`, walking in `direction` and wrapping
 * around the table. The double modulo keeps the result non-negative when
 * direction is -1.
 */
export function nextIndex(
  current: number,
  direction: Direction,
  playerCount: number,
  step = 1,
): number {
  const raw = (current + direction * step) % playerCount;
  return (raw + playerCount) % playerCount;
}

export function reverse(direction: Direction): Direction {
  return direction === 1 ? -1 : 1;
}
