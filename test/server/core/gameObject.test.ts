// The Durable Object adapter in the real Workers runtime: events in, state saved, effects out —
// across hibernation wakes, restarts that drop sockets, code updates, liveness and deletion.
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GameObject } from '../../../src/server/GameObject';
import {
  MAX_ANONYMOUS_CONNECTIONS,
  OVERDUE_DEADLINE_RETRY_MS,
  PROTOCOL_VERSION,
} from '../../../src/shared/constants';
import type { ConnId, PlayerId } from '../../../src/shared/protocol';
import { Phone, createGame, setClock, settle, storedState, stub, tokenFor } from './phone';
import type { GameState } from './types';

/** A lobby: the host's phone plus joined players, everyone welcomed. */
async function lobby(names: readonly string[] = ['Aino']) {
  const game = await createGame();
  const host = await Phone.hello(game.key, game.token);
  const hostId = (await host.next('welcome')).playerId;
  const players: { phone: Phone; id: PlayerId; token: string }[] = [];
  for (const name of names) {
    const token = tokenFor(`${name}-${game.key}`);
    const phone = await Phone.hello(game.key, token, name);
    players.push({ phone, id: (await phone.next('welcome')).playerId, token });
  }
  return { ...game, host, hostId, players };
}

/** The server-side socket of a player (found by its tag, as the adapter does). */
async function connIdOf(key: string, playerId: PlayerId): Promise<ConnId> {
  const state = await storedState(key);
  const connId = state?.players[playerId]?.connId;
  if (connId == null) throw new Error('player is offline');
  return connId;
}

describe('the lobby over real sockets', () => {
  it('welcome to the joiner, playerJoined to the others; the creator is the host', async () => {
    const game = await createGame();
    const host = await Phone.hello(game.key, game.token);
    const welcome = await host.next('welcome');
    expect(welcome.snapshot.hostId).toBe(welcome.playerId);
    const aino = await Phone.hello(game.key, tokenFor(`aino-${game.key}`), 'Aino');
    const ainoWelcome = await aino.next('welcome');
    expect(ainoWelcome.snapshot.hostId).toBe(welcome.playerId); // joining never makes you host
    expect((await host.next('playerJoined')).player.nickname).toBe('Aino');
  });

  it('a second phone with the same token wins; the old one is told REPLACED, then closed (G-18)', async () => {
    const game = await lobby([]);
    const second = await Phone.hello(game.key, game.token);
    expect((await second.next('welcome')).playerId).toBe(game.hostId);
    expect(await game.host.next('error')).toEqual({ type: 'error', code: 'REPLACED' });
    expect((await game.host.closed()).code).toBe(4001);
  });

  it('time sync is answered and writes nothing', async () => {
    const game = await lobby();
    const before = JSON.stringify(await storedState(game.key));
    game.host.send({ type: 'timeSync', t0: 1234 });
    const reply = await game.host.next('timeSync');
    expect(reply.t0).toBe(1234);
    expect(typeof reply.serverTime).toBe('number');
    expect(JSON.stringify(await storedState(game.key))).toBe(before);
  });
});

describe('protocol version comes with the socket URL (CLAUDE.md §4)', () => {
  it.each([
    [PROTOCOL_VERSION - 1, 'OUTDATED_CLIENT'],
    [null, 'OUTDATED_CLIENT'], // no ?v= at all
    [PROTOCOL_VERSION + 1, 'SERVER_UPDATING'], // newer phone: wait, don't reload (no reload loop)
  ] as const)('version %s → %s, closed, never registered', async (version, code) => {
    const { key } = await createGame();
    const phone = await Phone.open(key, version);
    expect(await phone.next('error')).toEqual({ type: 'error', code });
    expect((await phone.closed()).code).toBe(4004);
    expect(Object.keys((await storedState(key))?.connections ?? {})).toEqual([]);
  });
});

describe('untrusted input (CLAUDE.md §7)', () => {
  it('binary frames, oversized messages (counted in bytes), broken JSON and bad shapes get INVALID', async () => {
    const game = await lobby([]);
    const phone = game.host;
    phone.sendRaw(new Uint8Array([1, 2, 3]).buffer);
    expect(await phone.next('error')).toEqual({ type: 'error', code: 'INVALID' });
    // 2,100 "ä" = 4,200 bytes but only 2,100 characters: still too big.
    phone.sendRaw(JSON.stringify({ type: 'timeSync', t0: 1, pad: 'ä'.repeat(2100) }));
    expect(await phone.next('error')).toEqual({ type: 'error', code: 'INVALID' });
    phone.sendRaw('{not json');
    expect(await phone.next('error')).toEqual({ type: 'error', code: 'INVALID' });
    phone.send({ type: 'hello', token: 'short' });
    expect(await phone.next('error')).toEqual({ type: 'error', code: 'INVALID', for: 'hello' });
  });

  it(`at most ${MAX_ANONYMOUS_CONNECTIONS} sockets that never say who they are`, async () => {
    const { key } = await createGame();
    const sockets: Phone[] = [];
    for (let i = 0; i < MAX_ANONYMOUS_CONNECTIONS; i++) sockets.push(await Phone.open(key));
    const oneTooMany = await Phone.open(key);
    expect(await oneTooMany.next('error')).toEqual({ type: 'error', code: 'NOT_ALLOWED' });
    expect((await oneTooMany.closed()).code).toBe(4006);
    expect(sockets[0]?.closedWith).toBeNull();
  });
});

describe('hibernation and restarts (CLAUDE.md §3, §4)', () => {
  it('a plain hibernation wake sends nobody anything', async () => {
    const game = await lobby(['Aino']);
    const aino = game.players[0]?.phone;
    await settle();
    game.host.inbox.length = 0;
    aino?.inbox.splice(0);
    await evictDurableObject(stub(game.key)); // sockets hibernate, memory is gone
    game.host.send({ type: 'timeSync', t0: 1 });
    await game.host.next('timeSync');
    await settle(50);
    expect(game.host.pending()).toEqual([]);
    expect(aino?.pending()).toEqual([]);
    const state = await storedState(game.key);
    expect(state?.players[game.hostId]?.connId).not.toBeNull(); // still online after the wake
  });

  it('a restart that drops every socket: players come back as themselves, the others show offline', async () => {
    const game = await lobby(['Aino']);
    await evictDurableObject(stub(game.key), { webSockets: 'close' });
    const back = await Phone.hello(game.key, game.token);
    const welcome = await back.next('welcome');
    expect(welcome.playerId).toBe(game.hostId); // the saved state survived
    expect(welcome.snapshot.hostId).toBe(game.hostId);
    const aino = welcome.snapshot.players.find((p) => p.playerId === game.players[0]?.id);
    expect(aino?.online).toBe(false); // never trusted from storage
  });

  it('a restart that lost the last unanswered player ends the round — and the others hear it', async () => {
    const game = await lobby(['Aino', 'Ville']);
    const [aino, ville] = game.players;
    if (!aino || !ville) throw new Error('setup');
    game.host.send({ type: 'start' });
    await game.host.next('roundStarted');
    const round = (await storedState(game.key))?.round;
    if (!round) throw new Error('no round');
    await setClock(game.key, round.answerStartsAt);
    for (const phone of [game.host, aino.phone]) {
      phone.send({ type: 'submit', roundId: 1, ranking: round.candidates });
    }
    await game.host.next('playerReady');
    await game.host.next('playerReady');

    // Pretend a restart lost Ville's socket: the saved state still points at a socket that no
    // longer exists, and his real socket says it's nobody's.
    const villeConn = await connIdOf(game.key, ville.id);
    await runInDurableObject(stub(game.key), (_o: GameObject, state) => {
      const saved = state.storage.kv.get<Record<string, never>>('state') as unknown as {
        players: Record<string, { connId: string }>;
        connections: Record<string, unknown>;
      };
      const ghost = 'ghost-socket';
      const player = saved.players[ville.id];
      if (player) player.connId = ghost;
      saved.connections[ghost] = { playerId: ville.id, protocolVersion: PROTOCOL_VERSION };
      delete saved.connections[villeConn];
      state.storage.kv.put('state', saved);
      const ws = state.getWebSockets(villeConn)[0];
      const attachment = ws?.deserializeAttachment() as Record<string, unknown>;
      delete attachment.playerId;
      ws?.serializeAttachment(attachment);
    });
    await evictDurableObject(stub(game.key));
    await setClock(game.key, round.answerStartsAt + 1);
    game.host.send({ type: 'timeSync', t0: 1 }); // wakes it: load → rebuild

    expect((await game.host.next('roundResults')).results.answerCount).toBe(2);
    expect((await aino.phone.next('roundResults')).results.answerCount).toBe(2);
  });

  it('after a code update, a surviving socket from an older app is told OUTDATED_CLIENT and closed', async () => {
    const game = await lobby(['Aino']);
    const aino = game.players[0];
    if (!aino) throw new Error('setup');
    const ainoConn = await connIdOf(game.key, aino.id);
    // As if the server's PROTOCOL_VERSION had moved past the version Aino's phone connected with.
    await runInDurableObject(stub(game.key), (_o: GameObject, state) => {
      const ws = state.getWebSockets(ainoConn)[0];
      const attachment = ws?.deserializeAttachment() as Record<string, unknown>;
      ws?.serializeAttachment({ ...attachment, protocolVersion: PROTOCOL_VERSION - 1 });
    });
    await evictDurableObject(stub(game.key)); // the restart onto new code; sockets survive
    game.host.send({ type: 'timeSync', t0: 1 }); // wakes it: rebuild re-checks every socket
    expect(await aino.phone.next('error')).toEqual({ type: 'error', code: 'OUTDATED_CLIENT' });
    expect((await aino.phone.closed()).code).toBe(4004);
    expect((await game.host.next('playerConnection')).online).toBe(false);
  });

  it('a saved state the code can no longer read ends the game as "updated" — for everyone', async () => {
    const game = await lobby(['Aino']);
    await runInDurableObject(stub(game.key), (_o: GameObject, state) => {
      const saved = state.storage.kv.get<Record<string, unknown>>('state');
      state.storage.kv.put('state', { ...saved, stateVersion: 999 });
    });
    await evictDurableObject(stub(game.key));
    game.host.send({ type: 'timeSync', t0: 1 });
    expect(await game.host.next('gameEnded')).toEqual({
      type: 'gameEnded',
      reason: 'updated',
      summary: null,
    });
    expect((await game.players[0]?.phone.next('gameEnded'))?.reason).toBe('updated');
    const late = await Phone.hello(game.key, tokenFor('late'), 'Late');
    expect((await late.next('gameEnded')).reason).toBe('updated');
    expect((await storedState(game.key))?.endReason).toBe('updated'); // kept for the retention
  });

  it('an approval still reaches a "That\'s me" requester after a wake (G-44)', async () => {
    const game = await lobby(['Aino']);
    const aino = game.players[0];
    if (!aino) throw new Error('setup');
    aino.phone.close();
    await game.host.next('playerConnection');
    const requester = await Phone.hello(game.key, tokenFor('new-phone'), 'Aino');
    const taken = await requester.next('error');
    expect(taken).toMatchObject({ code: 'NAME_TAKEN', reclaimPlayerId: aino.id });
    requester.send({
      type: 'reclaim',
      playerId: aino.id,
      token: tokenFor('new-phone'),
      nickname: 'Aino',
      presetId: 'cat',
    });
    await requester.next('reclaimPending');
    const { request } = await game.host.next('reclaimRequested');

    await evictDurableObject(stub(game.key));
    game.host.send({ type: 'answerReclaim', requestId: request.requestId, approve: true });
    expect(await requester.next('reclaimResult')).toEqual({
      type: 'reclaimResult',
      approved: true,
    });
    expect((await requester.next('welcome')).playerId).toBe(aino.id);
  });
});

describe('deadlines take effect with every event, not only when the alarm fires', () => {
  it('a host answering an expired "That\'s me" after its deadline, before the alarm: it is denied (G-44)', async () => {
    const game = await lobby(['Aino']);
    const aino = game.players[0];
    if (!aino) throw new Error('setup');
    aino.phone.close();
    await game.host.next('playerConnection');
    const requester = await Phone.hello(game.key, tokenFor('new-phone'), 'Aino');
    await requester.next('error');
    requester.send({
      type: 'reclaim',
      playerId: aino.id,
      token: tokenFor('new-phone'),
      nickname: 'Aino',
      presetId: 'cat',
    });
    await requester.next('reclaimPending');
    const { request } = await game.host.next('reclaimRequested');

    // The request has expired, but the alarm hasn't run (late, or retried).
    await setClock(game.key, request.expiresAt + 1_000);
    game.host.send({ type: 'answerReclaim', requestId: request.requestId, approve: true });
    expect(await requester.next('reclaimResult')).toEqual({
      type: 'reclaimResult',
      approved: false,
    });
    const back = await Phone.hello(game.key, aino.token); // Aino's own phone still owns her spot
    expect((await back.next('welcome')).playerId).toBe(aino.id);
  });

  it('a deadline nothing clears is retried later, not at once forever (free-plan request budget)', async () => {
    const game = await lobby([]);
    // No open sockets, so no liveness check competes for the alarm (it would be at most 30 s away).
    game.host.close();
    await game.host.closed();
    await settle();
    // A state with a due deadline that no handler consumes (a round deadline in the lobby).
    await runInDurableObject(stub(game.key), async (_o: GameObject, state) => {
      const saved = state.storage.kv.get<GameState>('state');
      if (saved === undefined) throw new Error('setup');
      state.storage.kv.put('state', { ...saved, deadlines: { ...saved.deadlines, roundEnd: 1 } });
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    await evictDurableObject(stub(game.key));
    const before = Date.now();
    expect(await runDurableObjectAlarm(stub(game.key))).toBe(true);
    const next = await runInDurableObject(stub(game.key), (_o: GameObject, state) =>
      state.storage.getAlarm(),
    );
    expect(next).toBeGreaterThanOrEqual(before + OVERDUE_DEADLINE_RETRY_MS - 1_000);
  });
});

describe('effects are resilient (CLAUDE.md §4)', () => {
  it('one dead socket in a broadcast does not stop the others', async () => {
    const game = await lobby(['Aino', 'Ville']);
    const [aino, ville] = game.players;
    if (!aino || !ville) throw new Error('setup');
    // The host is first in the broadcast order: if a send on its dead socket stopped the loop,
    // nobody after it would hear anything.
    const hostConn = await connIdOf(game.key, game.hostId);
    const villeConn = await connIdOf(game.key, ville.id);
    await runInDurableObject(stub(game.key), (instance: GameObject, state) => {
      // The host's socket dies, and before its close event can arrive a broadcast goes out.
      state.getWebSockets(hostConn)[0]?.close(1011, 'gone');
      const villeWs = state.getWebSockets(villeConn)[0];
      if (!villeWs) throw new Error('no socket');
      instance.webSocketMessage(
        villeWs,
        JSON.stringify({ type: 'updateProfile', presetId: 'frog' }),
      );
    });
    expect((await aino.phone.next('playerUpdated')).avatar.presetId).toBe('frog');
    expect((await ville.phone.next('playerUpdated')).avatar.presetId).toBe('frog');
  });

  it('close and error events for the same socket count once', async () => {
    const game = await lobby(['Aino']);
    const aino = game.players[0];
    if (!aino) throw new Error('setup');
    const conn = await connIdOf(game.key, aino.id);
    await runInDurableObject(stub(game.key), (instance: GameObject, state) => {
      const ws = state.getWebSockets(conn)[0];
      if (!ws) throw new Error('no socket');
      instance.webSocketClose(ws);
      instance.webSocketError(ws);
    });
    await game.host.next('playerConnection');
    await settle(50);
    expect(game.host.pending()).not.toContain('playerConnection');
    expect((await storedState(game.key))?.players[aino.id]?.connId).toBeNull();
  });
});

describe('liveness check (CLAUDE.md §6)', () => {
  it('closes a socket silent for too long; one that pings — or is brand new — stays', async () => {
    const game = await lobby(['Aino']);
    const aino = game.players[0];
    if (!aino) throw new Error('setup');
    const hostConn = await connIdOf(game.key, game.hostId);
    const ainoConn = await connIdOf(game.key, aino.id);
    // Both were opened a minute ago; only Aino has pinged since.
    await runInDurableObject(stub(game.key), (_o: GameObject, state) => {
      for (const conn of [hostConn, ainoConn]) {
        const ws = state.getWebSockets(conn)[0];
        const attachment = ws?.deserializeAttachment() as Record<string, unknown>;
        ws?.serializeAttachment({ ...attachment, openedAt: Date.now() - 60_000 });
      }
    });
    aino.phone.ping();
    await settle();
    const fresh = await Phone.open(game.key); // never pinged, just opened

    expect(await runDurableObjectAlarm(stub(game.key))).toBe(true);
    expect((await game.host.closed()).code).toBe(4003);
    const offline = await aino.phone.next('playerConnection');
    expect(offline).toMatchObject({ playerId: game.hostId, online: false });
    expect(aino.phone.closedWith).toBeNull();
    expect(fresh.closedWith).toBeNull();
    // The host is now offline → the 60 s handover timer runs (G-41).
    expect((await storedState(game.key))?.deadlines.hostHandover).toBeTypeOf('number');
  });
});

describe('the end of a game (G-48)', () => {
  it('after the retention time: sockets closed, storage and alarm gone, a late socket sees "not found"', async () => {
    const game = await lobby(['Aino']);
    game.host.send({ type: 'end' });
    await game.host.next('gameEnded');
    const retention = (await storedState(game.key))?.deadlines.retention;
    if (retention === undefined) throw new Error('no retention deadline');
    await setClock(game.key, retention);
    await runDurableObjectAlarm(stub(game.key));

    expect((await game.host.closed()).code).toBe(4002);
    expect(await storedState(game.key)).toBeUndefined();
    const alarm = await runInDurableObject(stub(game.key), (_o: GameObject, state) =>
      state.storage.getAlarm(),
    );
    expect(alarm).toBeNull();

    const late = await Phone.hello(game.key, game.token);
    expect(await late.next('error')).toEqual({ type: 'error', code: 'NOT_FOUND' });
    expect(await storedState(game.key)).toBeUndefined(); // a late message never recreates it
  });
});
