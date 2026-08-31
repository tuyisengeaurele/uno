# @uno/server

The realtime game server. Express for a health check and a room summary endpoint,
Socket.IO for gameplay, an in-memory room store behind a `RoomStore` interface.

The engine is the authority. Every move goes through `session.applyPlayerAction`,
which checks the sender is the actor, runs `@uno/engine`, saves the RNG position
on the room, and sends each participant a redacted delta.

## Running locally

```bash
cp ../../.env.example .env   # PORT, CORS_ORIGIN, LOG_LEVEL
pnpm --filter @uno/server dev
```

`GET /health` reports status and the live room count. `GET /rooms/:code` returns a
room's public summary.

## Scaling

The room store and the reconnect token registry are in-memory. One instance
handles many concurrent rooms. Running more than one instance means implementing
`RoomStore` against Redis and adding the Socket.IO Redis adapter; nothing else in
the codebase changes.
