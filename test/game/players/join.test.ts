// 3A: creating a game, joining, resuming, the errors a phone can get from hello, and
// "newest socket wins". Every step runs through apply() (invariants + message schemas).
import { describe, expect, it } from 'vitest';
import { applyClaim } from '../../../src/game/engine';
import { MAX_PLAYERS, PROTOCOL_VERSION, WS_CLOSE } from '../../../src/shared/constants';
import { C, GAME_KEY, P, T0, gameId } from '../../fixtures/common';
import {
  endedState,
  fakeTokenHash,
  lobbyState,
  questionState,
  updatedEndState,
} from '../../fixtures/states';
import { expectValidState } from '../helpers';
import { broadcasts, closed, conn, only, sentTo, session, types } from './session';

const ctx = { now: T0, random: () => 0.25 };

describe('claim — creating a game (G-10)', () => {
  it('creates a lobby with the creator as host, offline until their phone connects', () => {
    const result = applyClaim(
      { key: GAME_KEY, nickname: '  Mikko ', presetId: 'fox', tokenHash: fakeTokenHash(1) },
      ctx,
    );
    if (!result.ok) throw new Error('claim failed');
    expect(result.state.hostId).toBe(result.playerId);
    expect(result.state.phase).toBe('LOBBY');
    expect(result.state.players[result.playerId]).toMatchObject({
      nickname: 'Mikko',
      connId: null,
      tokenHash: fakeTokenHash(1),
    });
    expectValidState(result.state);
  });

  it('rejects an invalid nickname (G-1)', () => {
    expect(
      applyClaim(
        { key: GAME_KEY, nickname: '   ', presetId: 'fox', tokenHash: fakeTokenHash(1) },
        ctx,
      ),
    ).toEqual({ ok: false, error: 'INVALID_NICKNAME' });
  });

  it('the host connects with the same token and gets the lobby — no "first to connect" rule', () => {
    const result = applyClaim(
      { key: GAME_KEY, nickname: 'Mikko', presetId: 'fox', tokenHash: fakeTokenHash(1) },
      ctx,
    );
    if (!result.ok) throw new Error('claim failed');
    const game = session(result.state);
    const effects = game.hello(conn('host'), 1);
    const welcome = only(sentTo(effects, conn('host')), 'welcome');
    expect(welcome.playerId).toBe(result.playerId);
    expect(welcome.snapshot.hostId).toBe(result.playerId);
    expect(game.state.idleSince).toBeNull();
  });
});

describe('joining as a new player', () => {
  it('announces the newcomer to the others and welcomes them with a lobby snapshot', () => {
    const game = session(lobbyState());
    const effects = game.hello(conn('juho'), 5, { nickname: 'Juho' });
    const welcome = only(sentTo(effects, conn('juho')), 'welcome');
    expect(welcome.snapshot.phase).toBe('LOBBY');
    expect(welcome.snapshot.players).toHaveLength(5);
    const joined = only(broadcasts(effects), 'playerJoined');
    expect(joined.player).toMatchObject({ nickname: 'Juho', online: true });
    expect(game.state.players[welcome.playerId]?.activeFromRound).toBe(1);
  });

  it('a retried hello with the same token after a lost welcome resumes, never duplicates (G-16)', () => {
    const game = session(lobbyState());
    game.hello(conn('juho'), 5, { nickname: 'Juho' });
    const id = game.playerWithToken(5);
    game.close(conn('juho'));
    const effects = game.hello(conn('juho-2'), 5, { nickname: 'Juho' });
    expect(only(sentTo(effects, conn('juho-2')), 'welcome').playerId).toBe(id);
    expect(Object.keys(game.state.players)).toHaveLength(5);
  });

  it('an unknown token without a nickname is NOT_FOUND (automatic reconnects never join, G-12)', () => {
    const game = session(lobbyState());
    expect(sentTo(game.hello(conn('x'), 77), conn('x'))).toEqual([
      { type: 'error', code: 'NOT_FOUND', for: 'hello' },
    ]);
  });

  it('a token from an earlier game under the same key is NOT_FOUND', () => {
    const game = session(lobbyState());
    game.open(conn('x'));
    const effects = game.send(conn('x'), {
      type: 'hello',
      tokenHash: fakeTokenHash(2),
      gameId: gameId('OldGame00001'),
    });
    expect(sentTo(effects, conn('x'))).toEqual([
      { type: 'error', code: 'NOT_FOUND', for: 'hello' },
    ]);
  });

  it('rejects an invalid nickname (G-1)', () => {
    const game = session(lobbyState());
    expect(sentTo(game.hello(conn('x'), 9, { nickname: ' \t ' }), conn('x'))).toEqual([
      { type: 'error', code: 'INVALID_NICKNAME', for: 'hello' },
    ]);
  });

  it('"Name taken" ignores case and spaces; online owner → no "That\'s me" (G-14)', () => {
    const game = session(lobbyState());
    expect(sentTo(game.hello(conn('x'), 9, { nickname: ' aino ' }), conn('x'))).toEqual([
      { type: 'error', code: 'NAME_TAKEN', for: 'hello' },
    ]);
  });

  it('"Name taken" by an OFFLINE owner offers "That\'s me" (G-14, G-44)', () => {
    const game = session(lobbyState());
    game.close(C.aino);
    expect(sentTo(game.hello(conn('x'), 9, { nickname: 'Aino' }), conn('x'))).toEqual([
      { type: 'error', code: 'NAME_TAKEN', for: 'hello', reclaimPlayerId: P.aino },
    ]);
  });

  it(`a full game (${MAX_PLAYERS} active players) says GAME_FULL (G-13)`, () => {
    const game = session(lobbyState());
    for (let i = 0; i < MAX_PLAYERS - 4; i++)
      game.hello(conn(`p${i}`), 100 + i, { nickname: `P${i}` });
    expect(Object.keys(game.state.players)).toHaveLength(MAX_PLAYERS);
    expect(sentTo(game.hello(conn('late'), 999, { nickname: 'Late' }), conn('late'))).toEqual([
      { type: 'error', code: 'GAME_FULL', for: 'hello' },
    ]);
  });

  it('a finished game takes no new players, but a known token sees Game Over (G-12, G-48)', () => {
    const game = session(endedState());
    expect(sentTo(game.hello(conn('x'), 9, { nickname: 'New' }), conn('x'))).toEqual([
      { type: 'error', code: 'NOT_FOUND', for: 'hello' },
    ]);
    game.close(C.aino);
    const welcome = only(sentTo(game.hello(conn('aino-2'), 2), conn('aino-2')), 'welcome');
    expect(welcome.snapshot).toMatchObject({ phase: 'ENDED', endReason: 'finished' });
  });

  it('a game ended by an update just says so (CLAUDE.md §4)', () => {
    const game = session(updatedEndState());
    expect(sentTo(game.hello(conn('x'), 2), conn('x'))).toEqual([
      { type: 'gameEnded', reason: 'updated', summary: null },
    ]);
  });
});

describe('late joiners (G-15, G-19)', () => {
  it('join mid-round as watchers, take part from the next round, start level on timesShown', () => {
    const game = session(questionState()); // round 1 running, everyone shown once
    const effects = game.hello(conn('late'), 7, { nickname: 'Late Lauri' });
    const welcome = only(sentTo(effects, conn('late')), 'welcome');
    const late = game.state.players[welcome.playerId];
    expect(late?.activeFromRound).toBe(2);
    expect(late?.timesShown).toBe(1);
    expect(welcome.snapshot.phase).toBe('QUESTION');
    expect(
      welcome.snapshot.players.find((p) => p.playerId === welcome.playerId)?.waitingForNextRound,
    ).toBe(true);
  });
});

describe('resuming & one socket per player (G-16, G-18)', () => {
  it('a reconnect after Ready lands on the waiting screen (you.submitted)', () => {
    const game = session(questionState()); // Aino has answered
    game.close(C.aino);
    const welcome = only(sentTo(game.hello(conn('aino-2'), 2), conn('aino-2')), 'welcome');
    expect(welcome.snapshot).toMatchObject({ phase: 'QUESTION', you: { submitted: true } });
  });

  it('the newest connection wins: the old socket is told REPLACED and closed', () => {
    const game = session(lobbyState());
    const effects = game.hello(conn('aino-new'), 2);
    expect(sentTo(effects, C.aino)).toEqual([{ type: 'error', code: 'REPLACED' }]);
    expect(closed(effects)).toEqual([C.aino]);
    expect(effects).toContainEqual({
      kind: 'close',
      connId: C.aino,
      code: WS_CLOSE.REPLACED,
      reason: 'replaced',
    });
    // Aino never went offline, so nobody is told she did.
    expect(types(broadcasts(effects))).not.toContain('playerConnection');
  });

  it("the replaced socket's close doesn't mark the player offline", () => {
    const game = session(lobbyState());
    game.hello(conn('aino-new'), 2);
    game.close(C.aino);
    expect(game.state.players[P.aino]?.connId).toBe(conn('aino-new'));
    expect(game.effects).toEqual([]);
  });

  it('a socket opened with another protocol version is told to reload / wait, closed, never registered (CLAUDE.md §4)', () => {
    for (const [version, code] of [
      [PROTOCOL_VERSION - 1, 'OUTDATED_CLIENT'], // incl. 0 = no / unreadable ?v= in the URL
      [PROTOCOL_VERSION + 1, 'SERVER_UPDATING'],
    ] as const) {
      const game = session(lobbyState());
      const effects = game.event({
        kind: 'connectionOpened',
        connId: conn('x'),
        protocolVersion: version,
      });
      expect(sentTo(effects, conn('x'))).toEqual([{ type: 'error', code }]);
      expect(closed(effects)).toEqual([conn('x')]);
      expect(game.state.connections[conn('x')]).toBeUndefined();
      // Its messages are refused (the DO stops forwarding anyway once it's closed).
      expect(game.send(conn('x'), { type: 'hello', tokenHash: fakeTokenHash(2) })).toEqual([
        {
          kind: 'send',
          connId: conn('x'),
          message: { type: 'error', code: 'NOT_ALLOWED', for: 'hello' },
        },
      ]);
    }
  });
});
