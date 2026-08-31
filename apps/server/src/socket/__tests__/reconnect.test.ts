import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JoinResult, PlayerView } from '@uno/contracts';

import {
  closeClients,
  connected,
  emitAck,
  nextEvent,
  startTestServer,
  type TestClient,
  type TestServer,
} from '../../testing/harness.js';

let server: TestServer;
const clients: TestClient[] = [];

const newClient = async (): Promise<TestClient> => {
  const client = await connected(server.url);
  clients.push(client);
  return client;
};

async function twoSeatRoom(): Promise<{
  code: string;
  host: TestClient;
  guest: TestClient;
  guestToken: string;
}> {
  const host = await newClient();
  const create = await emitAck<{ code: string }>(host, 'room:create', { name: 'Ada' });
  if (!create.ok) throw new Error(create.error.code);

  const guest = await newClient();
  const join = await emitAck<JoinResult>(guest, 'room:join', {
    code: create.data.code,
    name: 'Béla',
  });
  if (!join.ok) throw new Error(join.error.code);
  if (!join.data.seat) throw new Error('guest was not seated');

  return { code: create.data.code, host, guest, guestToken: join.data.playerToken };
}

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  closeClients(...clients.splice(0));
  await server.close();
});

describe('presence on disconnect', () => {
  it('marks the seat offline and keeps it', async () => {
    const { code, host, guest } = await twoSeatRoom();

    const presence = nextEvent<{ seatId: string; connected: boolean }>(host, 'room:presence');
    guest.close();
    await expect(presence).resolves.toMatchObject({ connected: false });

    const summary = await fetch(`${server.url}/rooms/${code}`).then((r) => r.json());
    expect(summary).toMatchObject({ seatCount: 2 });
  });
});

describe('room:reconnect', () => {
  it('rebinds the seat and restores the view', async () => {
    const { code, host, guest, guestToken } = await twoSeatRoom();

    const wentOffline = nextEvent<{ connected: boolean }>(host, 'room:presence');
    guest.close();
    clients.splice(clients.indexOf(guest), 1);
    await expect(wentOffline).resolves.toMatchObject({ connected: false });

    const cameBack = nextEvent<{ connected: boolean }>(host, 'room:presence');
    const rejoined = await newClient();
    const res = await emitAck<{ view: PlayerView }>(rejoined, 'room:reconnect', {
      code,
      playerToken: guestToken,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.view.self.id).toBeDefined();
      expect(res.data.view.players).toHaveLength(2);
    }
    await expect(cameBack).resolves.toMatchObject({ connected: true });
  });

  it('sends a fresh snapshot to the reconnecting socket', async () => {
    const { code, guest, guestToken } = await twoSeatRoom();
    guest.close();
    clients.splice(clients.indexOf(guest), 1);

    const rejoined = await newClient();
    const snapshot = nextEvent<{ view: PlayerView }>(rejoined, 'room:snapshot');
    await emitAck(rejoined, 'room:reconnect', { code, playerToken: guestToken });
    await expect(snapshot).resolves.toMatchObject({ view: { kind: 'player' } });
  });

  it('rejects a garbage token', async () => {
    const { code } = await twoSeatRoom();
    const client = await newClient();
    const res = await emitAck(client, 'room:reconnect', {
      code,
      playerToken: 'x'.repeat(43),
    });
    expect(res.ok || res.error.code).toBe('bad-token');
  });

  it('rejects a malformed payload', async () => {
    const client = await newClient();
    const res = await emitAck(client, 'room:reconnect', { code: 'ABCJK2' });
    expect(res.ok || res.error.code).toBe('invalid-payload');
  });

  it('reports room-not-found when the room was swept after the token was issued', async () => {
    const { code, guest, guestToken } = await twoSeatRoom();
    guest.close();
    clients.splice(clients.indexOf(guest), 1);
    server.store.delete(code);

    const client = await newClient();
    const res = await emitAck(client, 'room:reconnect', { code, playerToken: guestToken });
    expect(res.ok || res.error.code).toBe('room-not-found');
  });

  it('reports a bad token when the seat is gone from the room', async () => {
    const { code, guest, guestToken } = await twoSeatRoom();
    guest.close();
    clients.splice(clients.indexOf(guest), 1);

    const room = server.store.get(code);
    if (room === undefined) throw new Error('room missing');
    server.store.save({ ...room, seats: room.seats.slice(0, 1) });

    const client = await newClient();
    const res = await emitAck(client, 'room:reconnect', { code, playerToken: guestToken });
    expect(res.ok || res.error.code).toBe('bad-token');
  });

  it('rejects a reconnect to a room that is gone', async () => {
    const { guestToken } = await twoSeatRoom();
    const client = await newClient();
    const res = await emitAck(client, 'room:reconnect', {
      code: 'ZZZZZZ',
      playerToken: guestToken,
    });
    expect(res.ok || res.error.code).toBe('bad-token');
  });

  it('rate-limits repeated attempts', async () => {
    const client = await newClient();
    let limited = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await emitAck(client, 'room:reconnect', {
        code: 'ABCJK2',
        playerToken: 'y'.repeat(43),
      });
      if (!res.ok && res.error.code === 'rate-limited') {
        limited = true;
      }
    }
    expect(limited).toBe(true);
  });
});
