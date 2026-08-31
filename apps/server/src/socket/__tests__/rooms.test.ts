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

const createRoom = async (client: TestClient, name = 'Ada') => {
  const res = await emitAck<{ code: string; playerToken: string; view: PlayerView }>(
    client,
    'room:create',
    { name },
  );
  if (!res.ok) throw new Error(res.error.code);
  return res.data;
};

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  closeClients(...clients.splice(0));
  await server.close();
});

describe('room:create', () => {
  it('returns a code, a token, and the host view', async () => {
    const host = await newClient();
    const data = await createRoom(host);
    expect(data.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(data.playerToken.length).toBeGreaterThan(20);
    expect(data.view.players).toHaveLength(1);
    expect(data.view.board).toBeNull();
  });

  it('rejects an invalid name', async () => {
    const host = await newClient();
    const res = await emitAck(host, 'room:create', { name: 'a' });
    expect(res.ok || res.error.code).toBe('invalid-payload');
  });

  it('rate-limits repeated creation from one client', async () => {
    const host = await newClient();
    const codes: string[] = [];
    let limited = false;
    for (let i = 0; i < 7; i += 1) {
      const res = await emitAck<{ code: string }>(host, 'room:create', { name: 'Ada' });
      if (res.ok) {
        codes.push(res.data.code);
      } else if (res.error.code === 'rate-limited') {
        limited = true;
      }
    }
    expect(codes.length).toBe(5);
    expect(limited).toBe(true);
  });
});

describe('room:join', () => {
  it('seats a second player and notifies the host', async () => {
    const host = await newClient();
    const { code } = await createRoom(host);

    const joinerNotified = nextEvent(host, 'room:playerJoined');
    const guest = await newClient();
    const res = await emitAck<JoinResult>(guest, 'room:join', { code, name: 'Béla' });

    expect(res.ok && res.data.seat).toBe(true);
    if (res.ok && res.data.seat) {
      expect(res.data.view.players).toHaveLength(2);
    }
    await expect(joinerNotified).resolves.toMatchObject({ name: 'Béla' });
  });

  it('rejects an unknown code', async () => {
    const guest = await newClient();
    const res = await emitAck(guest, 'room:join', { code: 'ZZZZZZ', name: 'Béla' });
    expect(res.ok || res.error.code).toBe('room-not-found');
  });

  it('rejects a malformed join payload', async () => {
    const guest = await newClient();
    const res = await emitAck(guest, 'room:join', { name: 'Béla' });
    expect(res.ok || res.error.code).toBe('invalid-payload');
  });

  it('makes an eleventh player a spectator', async () => {
    const host = await newClient();
    const { code } = await createRoom(host);
    for (let i = 0; i < 9; i += 1) {
      const filler = await newClient();
      await emitAck(filler, 'room:join', { code, name: `P${String(i)}` });
    }

    const late = await newClient();
    const res = await emitAck<JoinResult>(late, 'room:join', { code, name: 'Late' });
    expect(res.ok && res.data.seat).toBe(false);
    if (res.ok && !res.data.seat) {
      expect(res.data.view.kind).toBe('spectator');
    }
  });
});

describe('room:leave', () => {
  it('deletes the room when the last seat leaves', async () => {
    const host = await newClient();
    const { code } = await createRoom(host);
    await emitAck(host, 'room:leave');

    const res = await fetch(`${server.url}/rooms/${code}`);
    expect(res.status).toBe(404);
  });

  it('drops a spectator that leaves', async () => {
    const host = await newClient();
    const { code } = await createRoom(host);
    // Fill all ten seats so the next joiner spectates.
    for (let i = 0; i < 9; i += 1) {
      const filler = await newClient();
      await emitAck(filler, 'room:join', { code, name: `F${String(i)}` });
    }
    const watcher = await newClient();
    await emitAck(watcher, 'room:join', { code, name: 'Watcher' });
    const before = await fetch(`${server.url}/rooms/${code}`).then((r) => r.json());
    expect(before).toMatchObject({ spectatorCount: 1 });

    await emitAck(watcher, 'room:leave');
    const after = await fetch(`${server.url}/rooms/${code}`).then((r) => r.json());
    expect(after).toMatchObject({ spectatorCount: 0 });
  });

  it('removes a seat in the lobby and tells the others', async () => {
    const host = await newClient();
    const { code } = await createRoom(host);
    const guest = await newClient();
    const joinRes = await emitAck<JoinResult>(guest, 'room:join', { code, name: 'Béla' });
    if (!joinRes.ok || !joinRes.data.seat) throw new Error('guest was not seated');
    const guestSeatId = joinRes.data.view.players.find((p) => p.name === 'Béla')?.id;

    const left = nextEvent<{ seatId: string; name: string }>(host, 'room:playerLeft');
    await emitAck(guest, 'room:leave');
    await expect(left).resolves.toEqual({ seatId: guestSeatId, name: 'Béla' });

    const summary = await fetch(`${server.url}/rooms/${code}`).then((r) => r.json());
    expect(summary).toMatchObject({ seatCount: 1 });
  });
});
