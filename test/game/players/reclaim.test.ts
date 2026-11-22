// 3A: "That's me" (G-44) — request, host answer, delivery across reconnects, expiry, closing.
import { describe, expect, it } from 'vitest';
import { RECLAIM_TTL_MS } from '../../../src/shared/constants';
import type { RequestId } from '../../../src/shared/protocol';
import { C, P } from '../../fixtures/common';
import { fakeTokenHash, lobbyState } from '../../fixtures/states';
import { broadcasts, conn, only, sentTo, session, toHostMessages, types } from './session';

const REQUESTER_TOKEN = 50;
const REQ = conn('requester');

/** Sanna's phone lost its login; a new phone asks to be her. */
function sannaRequested() {
  const game = session(lobbyState());
  game.close(C.sanna);
  game.hello(REQ, REQUESTER_TOKEN, { nickname: 'Sanna' }); // → NAME_TAKEN with reclaimPlayerId
  const effects = game.send(REQ, {
    type: 'reclaim',
    playerId: P.sanna,
    tokenHash: fakeTokenHash(REQUESTER_TOKEN),
    nickname: 'Sanna',
    presetId: 'owl',
  });
  const requestId = only(sentTo(effects, REQ), 'reclaimPending').requestId;
  return { game, effects, requestId };
}

const answer = (requestId: RequestId, approve: boolean) =>
  ({ type: 'answerReclaim', requestId, approve }) as const;

describe('asking', () => {
  it('the requester waits; the host is asked', () => {
    const { effects, requestId } = sannaRequested();
    const asked = only(toHostMessages(effects), 'reclaimRequested');
    expect(asked.request).toMatchObject({ requestId, targetPlayerId: P.sanna, nickname: 'Sanna' });
  });

  it('only for an offline active player, one request at a time', () => {
    const game = session(lobbyState());
    game.hello(REQ, REQUESTER_TOKEN);
    const ask = (playerId: typeof P.aino, token: number) =>
      game.send(REQ, {
        type: 'reclaim',
        playerId,
        tokenHash: fakeTokenHash(token),
        nickname: 'X',
        presetId: 'fox',
      });
    // Aino is online → unavailable.
    expect(sentTo(ask(P.aino, 60), REQ)).toEqual([
      { type: 'error', code: 'RECLAIM_UNAVAILABLE', for: 'reclaim' },
    ]);
    // A second request for Sanna from another phone while one is pending → unavailable.
    const { game: g2 } = sannaRequested();
    g2.hello(conn('second'), 61);
    const effects = g2.send(conn('second'), {
      type: 'reclaim',
      playerId: P.sanna,
      tokenHash: fakeTokenHash(61),
      nickname: 'Sanna',
      presetId: 'owl',
    });
    expect(sentTo(effects, conn('second'))).toEqual([
      { type: 'error', code: 'RECLAIM_UNAVAILABLE', for: 'reclaim' },
    ]);
  });
});

describe('the host answers', () => {
  it('approve → the requester continues AS that player, the old token stops working', () => {
    const { game, requestId } = sannaRequested();
    const effects = game.send(C.mikko, answer(requestId, true));
    expect(types(sentTo(effects, REQ))).toEqual(['reclaimResult', 'welcome']);
    expect(only(sentTo(effects, REQ), 'welcome').playerId).toBe(P.sanna);
    expect(toHostMessages(effects)).toEqual([{ type: 'reclaimClosed', requestId }]);
    expect(game.state.players[P.sanna]?.tokenHash).toBe(fakeTokenHash(REQUESTER_TOKEN));
    expect(game.state.reclaims).toEqual({});
    // Sanna's old phone (token 4) can't resume any more.
    expect(sentTo(game.hello(conn('old-phone'), 4), conn('old-phone'))).toEqual([
      { type: 'error', code: 'NOT_FOUND', for: 'hello' },
    ]);
  });

  it('deny → the requester hears no and is an anonymous connection again', () => {
    const { game, requestId } = sannaRequested();
    const effects = game.send(C.mikko, answer(requestId, false));
    expect(sentTo(effects, REQ)).toEqual([{ type: 'reclaimResult', approved: false }]);
    expect(game.state.connections[REQ]).toEqual({ protocolVersion: 1 });
  });

  it('auto-denied if the real player came back before the host answered', () => {
    const { game, requestId } = sannaRequested();
    game.hello(conn('sanna-back'), 4);
    const effects = game.send(C.mikko, answer(requestId, true));
    expect(sentTo(effects, REQ)).toEqual([{ type: 'reclaimResult', approved: false }]);
    expect(game.state.players[P.sanna]?.tokenHash).toBe(fakeTokenHash(4));
  });

  it("a late answer to a request that's already gone is ignored", () => {
    const { game, requestId } = sannaRequested();
    game.send(REQ, { type: 'cancelReclaim' });
    expect(game.send(C.mikko, answer(requestId, true))).toEqual([]);
  });
});

describe('across reconnects (screen lock, restart)', () => {
  it('a reconnecting requester is waiting again', () => {
    const { game, requestId } = sannaRequested();
    game.close(REQ);
    const effects = game.hello(conn('req-2'), REQUESTER_TOKEN);
    expect(sentTo(effects, conn('req-2'))).toEqual([{ type: 'reclaimPending', requestId }]);
  });

  it('an approval made while the requester was away is collected with hello', () => {
    const { game, requestId } = sannaRequested();
    game.close(REQ);
    game.send(C.mikko, answer(requestId, true));
    const effects = game.hello(conn('req-2'), REQUESTER_TOKEN);
    expect(types(sentTo(effects, conn('req-2')))).toEqual(['reclaimResult', 'welcome']);
    expect(game.state.reclaims).toEqual({});
  });

  it('a denial made while the requester was away is collected with hello', () => {
    const { game, requestId } = sannaRequested();
    game.close(REQ);
    game.send(C.mikko, answer(requestId, false));
    expect(sentTo(game.hello(conn('req-2'), REQUESTER_TOKEN), conn('req-2'))).toEqual([
      { type: 'reclaimResult', approved: false },
    ]);
    expect(game.state.reclaims).toEqual({});
  });
});

describe('collecting on the socket that is still waiting', () => {
  it('a denial collected by the bound socket itself leaves it anonymous (no dangling link)', () => {
    const { game, requestId } = sannaRequested();
    // The restart case: the denial was stored while the socket was bound but unreachable.
    const request = game.state.reclaims[requestId];
    if (request) request.status = 'denied';
    const effects = game.send(REQ, {
      type: 'hello',
      protocolVersion: 1,
      tokenHash: fakeTokenHash(REQUESTER_TOKEN),
    });
    expect(sentTo(effects, REQ)).toEqual([{ type: 'reclaimResult', approved: false }]);
    expect(game.state.connections[REQ]).toEqual({ protocolVersion: 1 });
  });
});

describe('closing requests', () => {
  it('cancel → the host is told, the request is gone', () => {
    const { game, requestId } = sannaRequested();
    const effects = game.send(REQ, { type: 'cancelReclaim' });
    expect(toHostMessages(effects)).toEqual([{ type: 'reclaimClosed', requestId }]);
    expect(game.state.reclaims).toEqual({});
  });

  it(`expires after ${RECLAIM_TTL_MS / 60_000} minutes`, () => {
    const { game, requestId } = sannaRequested();
    game.wait(RECLAIM_TTL_MS);
    const effects = game.deadline();
    expect(toHostMessages(effects)).toEqual([{ type: 'reclaimClosed', requestId }]);
    expect(sentTo(effects, REQ)).toEqual([{ type: 'reclaimResult', approved: false }]);
    expect(game.state.reclaims).toEqual({});
  });

  it('removing the target player closes the request (CLAUDE.md §6)', () => {
    const { game, requestId } = sannaRequested();
    game.wait(120_000);
    const effects = game.send(C.mikko, { type: 'removePlayer', playerId: P.sanna });
    expect(toHostMessages(effects)).toEqual([{ type: 'reclaimClosed', requestId }]);
    expect(sentTo(effects, REQ)).toEqual([{ type: 'reclaimResult', approved: false }]);
    expect(types(broadcasts(effects))).toContain('playerLeft');
  });
});
