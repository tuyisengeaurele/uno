import type { ProtocolError } from '@uno/contracts';

export type { ProtocolError };

export function protocolError(code: ProtocolError['code'], message: string): ProtocolError {
  return { code, message };
}
