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

  it('is refused when there are too few players', async () => {
    const host = await newClient();
    const create = await emitAck<{ code: string }>(host, 'room:create', { name: 'Solo' });
    expect(create.ok).toBe(true);
    const res = await emitAck(host, 'room:start');
    expect(res.ok || res.error.code).toBe('too-few-players');
  });

  it('reports room-not-found when the host room vanished', async () => {
    const { code, players } = await seatedGame(2);
    server.store.delete(code);
    const res = await emitAck(players[0]!.socket, 'room:start');
    expect(res.ok || res.error.code).toBe('room-not-found');
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

  it('rejects a malformed action payload', async () => {
    const { players } = await seatedGame(2);
    await emitAck(players[0]!.socket, 'room:start');
    const res = await emitAck(players[0]!.socket, 'game:action', { action: { type: 'nonsense' } });
    expect(res.ok || res.error.code).toBe('invalid-payload');
  });

  it('reports room-not-found when the room vanished', async () => {
    const { code, players } = await seatedGame(2);
    await emitAck(players[0]!.socket, 'room:start');
    server.store.delete(code);
    const res = await emitAck(players[0]!.socket, 'game:action', {
      action: { type: 'draw', playerId: players[0]!.id },
    });
    expect(res.ok || res.error.code).toBe('room-not-found');
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

describe('the turn timer', () => {
  it('auto-plays a seat that runs out of time', async () => {
    await server.close();
    server = await startTestServer({ maxTurnTimerMs: 60 });

    const { players } = await seatedGame(2);
    // Turn the timer on for this room.
    await emitAck(players[0]!.socket, 'room:updateSettings', {
      houseRules: {
        stacking: 'off',
        drawUntilPlayable: false,
        playDrawnCard: true,
        jumpIn: false,
        unoPenalty: 2,
        wildFourChallenge: true,
        targetScore: 500,
        firstCardRule: 'official',
      },
      turnTimerSeconds: 15,
    });

    const started = Promise.all(
      players.map((p) => nextEvent<{ view: PlayerView }>(p.socket, 'game:started')),
    );
    await emitAck(players[0]!.socket, 'room:start');
    const views = await started;
    const firstOnClock = views[0]?.view.board?.currentSeatId;

    // Both players sit idle. The server plays for whoever is on the clock, turn
    // after turn: a draw, plus a pass when the drawn card was playable.
    const autoSeats: string[] = [];
    await new Promise<void>((resolve) => {
      players[0]!.socket.on('game:delta', (payload) => {
        if (payload.autoPlayed !== undefined) {
          autoSeats.push(payload.autoPlayed);
          if (autoSeats.length >= 6) resolve();
        }
      });
    });

    expect(autoSeats[0]).toBe(firstOnClock);
    expect(new Set(autoSeats).size).toBe(2);
  }, 25_000);

  it('does not arm or auto-play when the timer is off', async () => {
    await server.close();
    server = await startTestServer({ maxTurnTimerMs: 40 });

    const host = await connected(server.url);
    clients.push(host);
    const create = await emitAck<{ code: string; view: PlayerView }>(host, 'room:create', {
      name: 'P0',
      turnTimerSeconds: null,
    });
    if (!create.ok) throw new Error(create.error.code);
    const guest = await connected(server.url);
    clients.push(guest);
    await emitAck(guest, 'room:join', { code: create.data.code, name: 'P1' });

    let sawTimer = false;
    let sawAuto = false;
    host.on('turn:timer', () => {
      sawTimer = true;
    });
    host.on('game:delta', (payload) => {
      if (payload.autoPlayed !== undefined) sawAuto = true;
    });

    await emitAck(host, 'room:start');
    await new Promise((r) => setTimeout(r, 150));
    expect(sawTimer).toBe(false);
    expect(sawAuto).toBe(false);
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

  it('locks settings once the game has started', async () => {
    const { players } = await seatedGame(2);
    await emitAck(players[0]!.socket, 'room:start');
    const res = await emitAck(players[0]!.socket, 'room:updateSettings', {
      houseRules: {
        stacking: 'off',
        drawUntilPlayable: false,
        playDrawnCard: true,
        jumpIn: false,
        unoPenalty: 2,
        wildFourChallenge: true,
        targetScore: 500,
        firstCardRule: 'official',
      },
      turnTimerSeconds: 20,
    });
    expect(res.ok || res.error.code).toBe('not-in-lobby');
  });

  it('rejects a malformed settings payload', async () => {
    const { players } = await seatedGame(2);
    const res = await emitAck(players[0]!.socket, 'room:updateSettings', { turnTimerSeconds: 20 });
    expect(res.ok || res.error.code).toBe('invalid-payload');
  });

  it('rejects room:nextRound from a non-host and before a round ends', async () => {
    const { players } = await seatedGame(2);
    await emitAck(players[0]!.socket, 'room:start');

    const nonHost = await emitAck(players[1]!.socket, 'room:nextRound');
    expect(nonHost.ok || nonHost.error.code).toBe('not-host');

    const early = await emitAck(players[0]!.socket, 'room:nextRound');
    expect(early.ok || early.error.code).toBe('no-active-round');
  });

  it('rejects room actions from someone not in a room', async () => {
    const stray = await newClient();
    const start = await emitAck(stray, 'room:start');
    expect(start.ok || start.error.code).toBe('not-a-player');
    const action = await emitAck(stray, 'game:action', {
      action: { type: 'draw', playerId: 'nobody' },
    });
    expect(action.ok || action.error.code).toBe('not-a-player');
  });
});
