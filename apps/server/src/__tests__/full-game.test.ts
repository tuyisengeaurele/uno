import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JoinResult, PlayerView, SpectatorView } from '@uno/contracts';
import type { HouseRules } from '@uno/engine';

import {
  autoDrive,
  closeClients,
  connected,
  emitAck,
  nextEvent,
  startTestServer,
  type DrivenPlayer,
  type TestClient,
  type TestServer,
} from '../testing/harness.js';

let server: TestServer;
const clients: TestClient[] = [];

const newClient = async (): Promise<TestClient> => {
  const client = await connected(server.url);
  clients.push(client);
  return client;
};

async function room(
  playerCount: number,
  create: { houseRules?: Partial<HouseRules>; turnTimerSeconds?: number | null } = {},
): Promise<{
  code: string;
  host: TestClient;
  players: DrivenPlayer[];
  tokens: Record<string, string>;
}> {
  const host = await newClient();
  const res = await emitAck<{ code: string; playerToken: string; view: PlayerView }>(
    host,
    'room:create',
    { name: 'P0', ...create },
  );
  if (!res.ok) throw new Error(res.error.code);
  const players: DrivenPlayer[] = [{ socket: host, id: res.data.view.self.id }];
  const tokens: Record<string, string> = { [res.data.view.self.id]: res.data.playerToken };

  for (let i = 1; i < playerCount; i += 1) {
    const guest = await newClient();
    const join = await emitAck<JoinResult>(guest, 'room:join', {
      code: res.data.code,
      name: `P${String(i)}`,
    });
    if (!join.ok || !join.data.seat) throw new Error('guest not seated');
    players.push({ socket: guest, id: join.data.view.self.id });
    tokens[join.data.view.self.id] = join.data.playerToken;
  }
  return { code: res.data.code, host, players, tokens };
}

beforeEach(async () => {
  server = await startTestServer({ maxTurnTimerMs: 50 });
});

afterEach(async () => {
  closeClients(...clients.splice(0));
  await server.close();
});

describe('a full round over sockets', () => {
  it('plays from the deal to a winner, and every client only ever sees its own hand', async () => {
    const { host, players } = await room(3);

    let leaked = false;
    for (const player of players) {
      player.socket.on('game:delta', ({ view }) => {
        if (view.kind !== 'player') return;
        for (const other of view.players) {
          if (Object.prototype.hasOwnProperty.call(other, 'hand')) {
            leaked = true;
          }
        }
      });
    }

    const driver = autoDrive(players);
    const ended = nextEvent<{ winnerId: string; scores: Record<string, number> }>(
      host,
      'game:roundEnded',
    );
    await emitAck(host, 'room:start');

    const result = await ended;
    driver.stop();

    expect(players.map((p) => p.id)).toContain(result.winnerId);
    expect(leaked).toBe(false);
  });
});

describe('a full match', () => {
  it('plays rounds until a score crosses the target', async () => {
    const { host, players } = await room(3, { houseRules: { targetScore: 100 } });
    const driver = autoDrive(players);

    let matchWinner: string | null = null;
    await emitAck(host, 'room:start');

    for (let round = 0; round < 30; round += 1) {
      const outcome = await Promise.race([
        nextEvent<{ scores: Record<string, number> }>(host, 'game:roundEnded').then((p) => ({
          kind: 'round' as const,
          ...p,
        })),
        nextEvent<{ winnerId: string }>(host, 'game:matchEnded').then((p) => ({
          kind: 'match' as const,
          ...p,
        })),
      ]);
      if (outcome.kind === 'match') {
        matchWinner = outcome.winnerId;
        break;
      }
      await emitAck(host, 'room:nextRound');
    }

    driver.stop();
    expect(matchWinner).not.toBeNull();
  });
});

describe('a spectator', () => {
  it('receives spectator views and cannot act', async () => {
    const { code, host, players } = await room(2);
    await emitAck(host, 'room:start');

    const watcher = await newClient();
    const join = await emitAck<JoinResult>(watcher, 'room:join', { code, name: 'Watcher' });
    expect(join.ok && !join.data.seat).toBe(true);

    const driver = autoDrive(players);
    const delta = await nextEvent<{ view: SpectatorView }>(watcher, 'game:delta');
    expect(delta.view.kind).toBe('spectator');
    expect(JSON.stringify(delta.view)).not.toContain('"hand"');

    const blocked = await emitAck(watcher, 'game:action', {
      action: { type: 'draw', playerId: players[0]!.id },
    });
    expect(blocked.ok || blocked.error.code).toBe('not-a-player');
    driver.stop();
  });
});

describe('a reconnect mid-round', () => {
  it('lets a dropped player rejoin and the round still finishes', async () => {
    const { code, host, players, tokens } = await room(2, { turnTimerSeconds: 15 });
    const guest = players[1]!;
    const guestToken = tokens[guest.id]!;

    await emitAck(host, 'room:start');
    await nextEvent(guest.socket, 'game:started');

    // The guest drops. The host keeps playing; the turn timer covers the guest.
    const wentOffline = nextEvent<{ connected: boolean }>(host, 'room:presence');
    guest.socket.close();
    clients.splice(clients.indexOf(guest.socket), 1);
    await expect(wentOffline).resolves.toMatchObject({ connected: false });

    const hostDriver = autoDrive([players[0]!]);
    await new Promise((r) => setTimeout(r, 200));

    // The guest comes back with its token and finishes the round.
    const rejoined = await newClient();
    const back = await emitAck<{ view: PlayerView }>(rejoined, 'room:reconnect', {
      code,
      playerToken: guestToken,
    });
    expect(back.ok).toBe(true);

    const ended = nextEvent<{ winnerId: string }>(host, 'game:roundEnded');
    const fullDriver = autoDrive([players[0]!, { socket: rejoined, id: guest.id }]);
    const result = await ended;
    hostDriver.stop();
    fullDriver.stop();

    expect([players[0]!.id, guest.id]).toContain(result.winnerId);
  });
});
