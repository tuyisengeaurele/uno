import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { JoinResult, PlayerView } from '@uno/contracts';

import {
  chooseMove,
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

interface Player {
  socket: TestClient;
  id: string;
}

async function seatedGame(count: number): Promise<{ code: string; players: Player[] }> {
  const host = await newClient();
  const create = await emitAck<{ code: string; view: PlayerView }>(host, 'room:create', {
    name: 'P0',
  });
  if (!create.ok) throw new Error(create.error.code);
  const code = create.data.code;
  const players: Player[] = [{ socket: host, id: create.data.view.self.id }];

  for (let i = 1; i < count; i += 1) {
    const guest = await newClient();
    const res = await emitAck<JoinResult>(guest, 'room:join', { code, name: `P${String(i)}` });
    if (!res.ok || !res.data.seat) throw new Error('guest not seated');
    players.push({ socket: guest, id: res.data.view.self.id });
  }
  return { code, players };
}

/** Play a round to completion, each client driving only from its own view. */
function runRound(
  players: Player[],
): Promise<{ winnerId: string; scores: Record<string, number> }> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let moves = 0;

    const assertNoLeak = (view: PlayerView) => {
      // Only the caller's hand is ever spelled out. Opponents are counts.
      for (const other of view.players) {
        expect(Object.keys(other).sort()).toEqual([
          'calledUno',
          'connected',
          'handCount',
          'id',
          'name',
        ]);
      }
    };

    const act = (view: PlayerView): void => {
      const board = view.board;
      if (finished || board?.status !== 'active') return;
      const mine =
        board.currentSeatId === view.self.id || board.awaitingColorChoiceFrom === view.self.id;
      if (!mine) return;

      moves += 1;
      if (moves > 500) {
        reject(new Error('round did not finish'));
        return;
      }
      const player = players.find((p) => p.id === view.self.id);
      /* c8 ignore next 3 -- the acting seat is always one of our clients */
      if (player === undefined) return;

      void emitAck<Record<string, never>>(player.socket, 'game:action', {
        action: chooseMove(view),
      }).then((res) => {
        if (!res.ok && !finished) {
          reject(new Error(`move rejected: ${res.error.code}`));
        }
      });
    };

    for (const player of players) {
      player.socket.on('game:started', ({ view }) => {
        if (view.kind === 'player') {
          assertNoLeak(view);
          act(view);
        }
      });
      player.socket.on('game:delta', ({ view }) => {
        if (view.kind === 'player') {
          assertNoLeak(view);
          act(view);
        }
      });
      player.socket.on('game:roundEnded', (payload) => {
        finished = true;

        resolve(payload);
      });
    }
  });
}

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  closeClients(...clients.splice(0));
  await server.close();
});

describe('room:start', () => {
  it('is refused for a non-host', async () => {
    const { players } = await seatedGame(2);
    const res = await emitAck(players[1]!.socket, 'room:start');
    expect(res.ok || res.error.code).toBe('not-host');
  });

  it('deals hands and shows opponents only as counts', async () => {
    const { players } = await seatedGame(2);
    const started = Promise.all(
      players.map((p) => nextEvent<{ view: PlayerView }>(p.socket, 'game:started')),
    );
    await emitAck(players[0]!.socket, 'room:start');
    const views = await started;

    for (const { view } of views) {
      // Seven cards, or nine if the flipped first card was a Draw Two.
      expect(view.self.hand.length).toBeGreaterThanOrEqual(7);
      expect(view.self.hand.length).toBeLessThanOrEqual(9);
      const opponent = view.players.find((p) => p.id !== view.self.id);
      expect(opponent?.handCount).toBeGreaterThanOrEqual(7);
      expect(opponent).not.toHaveProperty('hand');
    }
  });
});

describe('game:action', () => {
  it('runs a full round to a winner with no hand leaks', async () => {
    const { players } = await seatedGame(3);
    const round = runRound(players);
    await emitAck(players[0]!.socket, 'room:start');

    const result = await round;
    expect(players.map((p) => p.id)).toContain(result.winnerId);
    const total = Object.values(result.scores).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('rejects an action from a spectator', async () => {
    const { code, players } = await seatedGame(2);
    await emitAck(players[0]!.socket, 'room:start');

    const watcher = await newClient();
    const join = await emitAck<JoinResult>(watcher, 'room:join', { code, name: 'Watcher' });
    expect(join.ok && join.data.seat).toBe(false);

    const res = await emitAck(watcher, 'game:action', {
      action: { type: 'draw', playerId: players[0]!.id },
    });
    expect(res.ok || res.error.code).toBe('not-a-player');
  });

  it('rejects acting as another player and sends no delta', async () => {
    const { players } = await seatedGame(2);
    const started = nextEvent<{ view: PlayerView }>(players[0]!.socket, 'game:started');
    await emitAck(players[0]!.socket, 'room:start');
    await started;

    let sawDelta = false;
    players[0]!.socket.on('game:delta', () => {
      sawDelta = true;
    });

    const res = await emitAck(players[0]!.socket, 'game:action', {
      action: { type: 'draw', playerId: players[1]!.id },
    });
    expect(res.ok || res.error.code).toBe('wrong-actor');
    await new Promise((r) => setTimeout(r, 80));
    expect(sawDelta).toBe(false);
  });
});

describe('room:updateSettings', () => {
  it('lets the host change the turn timer and rejects a non-host', async () => {
    const { code, players } = await seatedGame(2);
    const rules = {
      stacking: 'off',
      drawUntilPlayable: false,
      playDrawnCard: true,
      jumpIn: false,
      unoPenalty: 2,
      wildFourChallenge: true,
      targetScore: 500,
      firstCardRule: 'official',
    } as const;

    const changed = nextEvent<{ room: { turnTimerSeconds: number | null } }>(
      players[0]!.socket,
      'room:settingsChanged',
    );
    const ok = await emitAck(players[0]!.socket, 'room:updateSettings', {
      houseRules: rules,
      turnTimerSeconds: 30,
    });
    expect(ok.ok).toBe(true);
    await expect(changed).resolves.toMatchObject({ room: { turnTimerSeconds: 30 } });

    const denied = await emitAck(players[1]!.socket, 'room:updateSettings', {
      houseRules: rules,
      turnTimerSeconds: 60,
    });
    expect(denied.ok || denied.error.code).toBe('not-host');
    void code;
  });
});
