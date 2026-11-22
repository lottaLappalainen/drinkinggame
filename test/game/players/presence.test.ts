// 3A: online/offline, host handover, rebuild after a load, photos, and the player-side deadlines.
import { describe, expect, it } from 'vitest';
import {
  ENDED_RETENTION_MS,
  HOST_HANDOVER_MS,
  IDLE_LOBBY_MS,
  PROTOCOL_VERSION,
} from '../../../src/shared/constants';
import { C, P } from '../../fixtures/common';
import { endedState, lobbyState, questionState } from '../../fixtures/states';
import { broadcasts, closed, conn, only, sentTo, session, toHostMessages, types } from './session';

describe('going offline and coming back', () => {
  it('a closed current socket → offline, announced with offlineSince (G-43 timer)', () => {
    const game = session(lobbyState());
    const effects = game.close(C.aino);
    expect(broadcasts(effects)).toEqual([
      { type: 'playerConnection', playerId: P.aino, online: false, offlineSince: game.now },
    ]);
    expect(game.state.players[P.aino]).toMatchObject({ connId: null, offlineSince: game.now });
  });

  it('coming back is announced to the others, not to the returning phone', () => {
    const game = session(lobbyState());
    game.close(C.aino);
    const effects = game.hello(conn('aino-2'), 2);
    expect(effects).toContainEqual({
      kind: 'broadcast',
      message: { type: 'playerConnection', playerId: P.aino, online: true, offlineSince: null },
      except: [P.aino],
    });
  });

  it('idle tracking: set when the last player goes offline, cleared when one returns', () => {
    const game = session(lobbyState());
    for (const c of [C.mikko, C.aino, C.ville]) game.close(c);
    expect(game.state.idleSince).toBeNull();
    game.close(C.sanna);
    expect(game.state.idleSince).toBe(game.now);
    game.wait(1_000);
    game.hello(conn('sanna-2'), 4);
    expect(game.state.idleSince).toBeNull();
  });

  it('an anonymous socket (join screen left open) does not keep a game alive', () => {
    const game = session(lobbyState());
    game.open(conn('anon'));
    for (const c of [C.mikko, C.aino, C.ville, C.sanna]) game.close(c);
    expect(game.state.idleSince).toBe(game.now);
  });
});

describe('host handover (GAME_DESCRIPTION §10, G-41)', () => {
  it('waits 60 s for an offline host, then passes the role to the longest-connected player', () => {
    const game = session(lobbyState());
    game.close(C.mikko);
    expect(game.state.deadlines.hostHandover).toBe(game.now + HOST_HANDOVER_MS);
    game.wait(HOST_HANDOVER_MS);
    const effects = game.deadline();
    expect(broadcasts(effects)).toContainEqual({ type: 'hostChanged', hostId: P.aino });
    expect(game.state.hostId).toBe(P.aino);
  });

  it('a host back within 60 s keeps the role', () => {
    const game = session(lobbyState());
    game.close(C.mikko);
    game.wait(30_000);
    game.hello(conn('mikko-2'), 1);
    expect(game.state.deadlines.hostHandover).toBeUndefined();
    game.wait(HOST_HANDOVER_MS);
    expect(types(broadcasts(game.deadline()))).not.toContain('hostChanged');
    expect(game.state.hostId).toBe(P.mikko);
  });

  it('nobody online → the role is vacant and goes to the next player who connects', () => {
    const game = session(lobbyState());
    for (const c of [C.aino, C.ville, C.sanna, C.mikko]) game.close(c);
    game.wait(HOST_HANDOVER_MS);
    game.deadline();
    expect(game.state.hostId).toBeNull();
    const effects = game.hello(conn('ville-2'), 3);
    expect(game.state.hostId).toBe(P.ville);
    expect(only(sentTo(effects, conn('ville-2')), 'welcome').snapshot.hostId).toBe(P.ville);
  });

  it('the new host is told about pending "That\'s me" requests', () => {
    const game = session(lobbyState());
    game.close(C.sanna);
    game.hello(conn('req'), 50);
    game.send(conn('req'), {
      type: 'reclaim',
      playerId: P.sanna,
      tokenHash: 'f'.repeat(64),
      nickname: 'Sanna',
      presetId: 'owl',
    });
    game.close(C.mikko);
    game.wait(HOST_HANDOVER_MS);
    const effects = game.deadline();
    expect(types(toHostMessages(effects))).toEqual(['reclaimRequested']);
  });
});

describe('rebuild after a load (CLAUDE.md §3/§4)', () => {
  const sockets = (names: ReadonlyArray<readonly [string, typeof P.aino]>) =>
    names.map(([name, playerId]) => ({
      connId: conn(name),
      protocolVersion: PROTOCOL_VERSION,
      playerId,
    }));
  const all = sockets([
    ['mikko', P.mikko],
    ['aino', P.aino],
    ['ville', P.ville],
    ['sanna', P.sanna],
  ]);

  it('a plain hibernation wake where every socket still exists sends nothing', () => {
    const game = session(lobbyState());
    expect(game.event({ kind: 'rebuild', sockets: all })).toEqual([]);
  });

  it('a socket lost in a restart is a real change: the others hear the player went offline', () => {
    const game = session(lobbyState());
    const effects = game.event({
      kind: 'rebuild',
      sockets: all.filter((s) => s.playerId !== P.ville),
    });
    expect(broadcasts(effects)).toEqual([
      { type: 'playerConnection', playerId: P.ville, online: false, offlineSince: game.now },
    ]);
  });

  it('a lost host socket starts the handover timer', () => {
    const game = session(lobbyState());
    game.event({ kind: 'rebuild', sockets: all.filter((s) => s.playerId !== P.mikko) });
    expect(game.state.deadlines.hostHandover).toBe(game.now + HOST_HANDOVER_MS);
  });

  it('a socket on an old protocol is told to reload and closed', () => {
    const game = session(lobbyState());
    const old = { connId: conn('old'), protocolVersion: PROTOCOL_VERSION + 1 };
    const effects = game.event({ kind: 'rebuild', sockets: [...all, old] });
    expect(sentTo(effects, conn('old'))).toEqual([{ type: 'error', code: 'SERVER_UPDATING' }]);
    expect(closed(effects)).toEqual([conn('old')]);
  });

  it('a lost socket of the last unanswered player ends the round — via the normal path (3B)', () => {
    // Aino answered; Mikko, Ville and Sanna lose their sockets → nobody left to wait for.
    const game = session(questionState(), questionState().round?.answerStartsAt ?? 0);
    const onlyAino = all.filter((s) => s.playerId === P.aino);
    // Closing the round is Phase 3B (closeRound) — reaching it proves the effects aren't dropped.
    expect(() => game.event({ kind: 'rebuild', sockets: onlyAino })).toThrow('closeRound');
  });
});

describe('photos', () => {
  it('a stored photo bumps photoVersion and tells everyone', () => {
    const game = session(lobbyState());
    const effects = game.event({ kind: 'photoStored', playerId: P.aino });
    expect(game.state.players[P.aino]?.avatar.photoVersion).toBe(1);
    expect(broadcasts(effects)).toEqual([
      {
        type: 'playerUpdated',
        playerId: P.aino,
        nickname: 'Aino',
        avatar: { presetId: 'cat', photoVersion: 1 },
      },
    ]);
  });
});

describe('deadlines: retention and idle cleanup (G-48, CLAUDE.md §6)', () => {
  it('a finished game is deleted after its retention time', () => {
    const game = session(endedState());
    game.wait(ENDED_RETENTION_MS);
    expect(game.deadline()).toEqual([{ kind: 'deleteGame' }]);
  });

  it('an empty lobby is deleted after IDLE_LOBBY_MS', () => {
    const lobby = session(lobbyState());
    for (const c of [C.mikko, C.aino, C.ville, C.sanna]) lobby.close(c);
    lobby.wait(IDLE_LOBBY_MS - 1);
    expect(lobby.deadline()).not.toContainEqual({ kind: 'deleteGame' });
    lobby.wait(1);
    expect(lobby.deadline()).toEqual([{ kind: 'deleteGame' }]);
  });
  // A STARTED game idles for IDLE_STARTED_MS instead (food break with every phone locked) — its
  // end-to-end test needs closeRound (the round-end deadline fires first), so it lives in 3B.
});
