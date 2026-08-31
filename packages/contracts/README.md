# @uno/contracts

The contract between the UNO server and client. One place for:

- **schemas** (`schemas.ts`): zod schemas for every message a client sends. The
  server parses at the socket boundary; nothing untrusted reaches a handler
  unvalidated.
- **events** (`events.ts`): the typed Socket.IO event maps, so both ends share
  one definition of what can be sent and what the acks look like.
- **views** (`views.ts`): the redacted shapes the server sends. A client never
  receives the full game state, only its own hand plus public counts.

Depends on `@uno/engine` for the shared card, action, and event types. No runtime
dependency on the server or the client.
