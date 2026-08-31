import { describe, expect, it } from 'vitest';

import { clientIp, type UnoSocket } from './context.js';

const socketWith = (headers: Record<string, string | string[]>, address: string): UnoSocket =>
  ({ handshake: { headers, address } }) as unknown as UnoSocket;

describe('clientIp', () => {
  it('uses the socket address when there is no forwarding header', () => {
    expect(clientIp(socketWith({}, '203.0.113.7'))).toBe('203.0.113.7');
  });

  it('takes the first hop from x-forwarded-for', () => {
    expect(clientIp(socketWith({ 'x-forwarded-for': '198.51.100.9, 203.0.113.1' }, '::1'))).toBe(
      '198.51.100.9',
    );
  });

  it('falls back to the address when the header is not a plain string', () => {
    expect(clientIp(socketWith({ 'x-forwarded-for': ['a', 'b'] }, '203.0.113.7'))).toBe(
      '203.0.113.7',
    );
  });
});
