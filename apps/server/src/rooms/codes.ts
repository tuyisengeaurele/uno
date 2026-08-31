// No I, O, 0, or 1: they are too easy to misread when a code is spoken or typed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 50;

export function generateRoomCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET.charAt(Math.floor(random() * ALPHABET.length));
  }
  return code;
}

/**
 * A room code that `isTaken` reports as free. Retries on collision and gives up
 * after {@link MAX_ATTEMPTS}, which only happens if the code space is somehow
 * exhausted or `isTaken` is misbehaving.
 */
export function uniqueRoomCode(
  isTaken: (code: string) => boolean,
  random: () => number = Math.random,
): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode(random);
    if (!isTaken(code)) {
      return code;
    }
  }
  throw new Error('could not allocate a free room code');
}
