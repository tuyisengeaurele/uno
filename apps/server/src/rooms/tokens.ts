import { randomBytes } from 'node:crypto';

export interface SeatRef {
  code: string;
  seatId: string;
}

export interface TokenRegistry {
  issue(code: string, seatId: string): string;
  resolve(token: string): SeatRef | undefined;
  revokeRoom(code: string): void;
}

/**
 * Opaque reconnect tokens. A client stores its token and presents it to reclaim
 * its seat after a refresh or a dropped connection. In-memory for now; a Redis
 * implementation of this same interface is the horizontal-scaling path.
 */
export function createTokenRegistry(): TokenRegistry {
  const byToken = new Map<string, SeatRef>();

  return {
    issue(code, seatId) {
      const token = randomBytes(32).toString('base64url');
      byToken.set(token, { code, seatId });
      return token;
    },
    resolve(token) {
      return byToken.get(token);
    },
    revokeRoom(code) {
      for (const [token, ref] of byToken) {
        if (ref.code === code) {
          byToken.delete(token);
        }
      }
    },
  };
}
