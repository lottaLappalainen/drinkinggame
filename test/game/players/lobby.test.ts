// 3A: profiles and settings in the lobby, leaving, removing, the pause flag, and the snapshot.
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../../src/game/handlers/players';
import { MIN_PLAYERS, REMOVE_OFFLINE_MIN_MS } from '../../../src/shared/constants';
import { C, P } from '../../fixtures/common';
import { lobbyState, lobbyWithReclaimState, questionState } from '../../fixtures/states';
import { broadcasts, conn, only, sentTo, session, types } from './session';

describe('own profile, lobby only (G-1, G-5, G-6)', () => {
  it('a new nickname and preset are cleaned, saved and shown to everyone', () => {
    const game = session(lobbyState());
    const effects = game.send(C.aino, {
      type: 'updateProfile',
      nickname: '  Aino\tK ',
      presetId: 'frog',
    });
    expect(broadcasts(effects)).toEqual([
      {
        type: 'playerUpdated',
        playerId: P.aino,
        nickname: 'Aino K',
        avatar: { presetId: 'frog', photoVersion: null },
      },
    ]);
    expect(game.state.players[P.aino]?.nameKey).toBe('aino k');
  });

  it("can't take someone else's name, can't be empty", () => {
    const game = session(lobbyState());
    expect(sentTo(game.send(C.aino, { type: 'updateProfile', nickname: 'VILLE' }), C.aino)).toEqual(
      [{ type: 'error', code: 'NAME_TAKEN', for: 'updateProfile' }],
    );
    expect(sentTo(game.send(C.aino, { type: 'updateProfile', nickname: '  ' }), C.aino)).toEqual([
      { type: 'error', code: 'INVALID_NICKNAME', for: 'updateProfile' },
    ]);
  });

  it('nothing changed → nothing sent', () => {
    const game = session(lobbyState());
    expect(game.send(C.aino, { type: 'updateProfile', presetId: 'cat' })).toEqual([]);
  });

  it('the host sets length and categories (G-20, G-22); only the host (engine rule)', () => {
    const game = session(lobbyState());
    const settings = { gameLength: 35, categories: ['personal', 'mild'] } as const;
    expect(
      broadcasts(
        game.send(C.mikko, {
          type: 'setSettings',
          settings: { ...settings, categories: [...settings.categories] },
        }),
      ),
    ).toEqual([
      // Stored and announced in display order.
      { type: 'settingsChanged', settings: { gameLength: 35, categories: ['mild', 'personal'] } },
    ]);
    // Same settings again (in any order) → nothing.
    expect(
      game.send(C.mikko, {
        type: 'setSettings',
        settings: { gameLength: 35, categories: ['mild', 'personal'] },
      }),
    ).toEqual([]);
    expect(
      game.send(C.aino, {
        type: 'setSettings',
        settings: { gameLength: 15, categories: ['mild'] },
      }),
    ).toEqual([
      {
        kind: 'send',
        connId: C.aino,
        message: { type: 'error', code: 'NOT_ALLOWED', for: 'setSettings' },
      },
    ]);
  });

  it('a selection too small for the length is accepted here — start refuses it (G-23)', () => {
    const game = session(lobbyState());
    const effects = game.send(C.mikko, {
      type: 'setSettings',
      settings: { gameLength: 35, categories: ['personal'] }, // 10 placeholder questions
    });
    expect(types(broadcasts(effects))).toEqual(['settingsChanged']);
    expect(game.state.settings).toEqual({ gameLength: 35, categories: ['personal'] });
  });

  it('the lobby snapshot carries question counts per category, never texts (G-22, G-33)', () => {
    const game = session(lobbyState());
    const welcome = only(sentTo(game.hello(conn('aino-2'), 2), conn('aino-2')), 'welcome');
    if (welcome.snapshot.phase !== 'LOBBY') throw new Error('expected the lobby');
    expect(welcome.snapshot.questionCounts).toEqual({ mild: 20, spicy: 10, personal: 10 });
    expect(welcome.snapshot.settings).toEqual({ gameLength: 25, categories: ['mild', 'spicy'] });
    expect(JSON.stringify(welcome)).not.toContain('placeholder');
  });
});

describe('leaving (G-41)', () => {
  it('the player is out: announced, socket anonymous, name free, token gets LEFT', () => {
    const game = session(lobbyState());
    const effects = game.send(C.aino, { type: 'leave' });
    expect(broadcasts(effects)).toContainEqual({
      type: 'playerLeft',
      playerId: P.aino,
      reason: 'left',
    });
    expect(effects).toContainEqual({ kind: 'bindConnection', connId: C.aino });
    // The leaving phone itself is told the leave went through (it keeps its token until then).
    expect(sentTo(effects, C.aino)).toEqual([{ type: 'leftGame' }]);
    expect(game.state.players[P.aino]?.status).toBe('left');
    // The name is free again…
    expect(
      types(sentTo(game.hello(conn('new-aino'), 30, { nickname: 'Aino' }), conn('new-aino'))),
    ).toEqual(['welcome']);
    // …and the old phone's token says LEFT, not "Game not found".
    expect(sentTo(game.hello(conn('old'), 2), conn('old'))).toEqual([
      { type: 'error', code: 'LEFT', for: 'hello' },
    ]);
  });

  it('a leaving host hands over at once — no 60 s wait', () => {
    const game = session(lobbyState());
    const effects = game.send(C.mikko, { type: 'leave' });
    expect(broadcasts(effects)).toContainEqual({ type: 'hostChanged', hostId: P.aino });
    expect(game.state.deadlines.hostHandover).toBeUndefined();
  });

  it('a host leaving with nobody else online leaves the role vacant', () => {
    const game = session(lobbyState());
    for (const c of [C.aino, C.ville, C.sanna]) game.close(c);
    game.send(C.mikko, { type: 'leave' });
    expect(game.state.hostId).toBeNull();
  });
});

describe('removing ghost players (G-43)', () => {
  it(`only after ${REMOVE_OFFLINE_MIN_MS / 60_000} minutes offline`, () => {
    const game = session(lobbyState());
    game.close(C.sanna);
    game.wait(REMOVE_OFFLINE_MIN_MS - 1);
    const remove = () => game.send(C.mikko, { type: 'removePlayer', playerId: P.sanna });
    expect(sentTo(remove(), C.mikko)).toEqual([
      { type: 'error', code: 'NOT_ALLOWED', for: 'removePlayer' },
    ]);
    game.wait(1);
    expect(broadcasts(remove())).toContainEqual({
      type: 'playerLeft',
      playerId: P.sanna,
      reason: 'removed',
    });
    expect(sentTo(game.hello(conn('sanna-phone'), 4), conn('sanna-phone'))).toEqual([
      { type: 'error', code: 'REMOVED', for: 'hello' },
    ]);
  });

  it('never an online player', () => {
    const game = session(lobbyState());
    game.wait(REMOVE_OFFLINE_MIN_MS);
    expect(sentTo(game.send(C.mikko, { type: 'removePlayer', playerId: P.aino }), C.mikko)).toEqual(
      [{ type: 'error', code: 'NOT_ALLOWED', for: 'removePlayer' }],
    );
  });
});

describe(`pause below ${MIN_PLAYERS} active players (G-42)`, () => {
  it('pauses mid-game when players leave, resumes when someone joins — never continues by itself', () => {
    const start = questionState().round?.startedAt ?? 0; // during the intro: no early end
    const game = session(questionState(), start);
    game.send(C.ville, { type: 'leave' });
    expect(game.state.paused).toBe(false);
    const effects = game.send(C.sanna, { type: 'leave' });
    expect(broadcasts(effects)).toContainEqual({ type: 'paused', needed: MIN_PLAYERS });
    // A late joiner counts toward the minimum (otherwise the game could never continue).
    const back = game.hello(conn('late'), 9, { nickname: 'Late' });
    expect(broadcasts(back)).toContainEqual({ type: 'resumed' });
    expect(game.state.phase).toBe('QUESTION');
  });

  it('never pauses in the lobby (Start just stays disabled, G-21)', () => {
    const game = session(lobbyState());
    game.send(C.ville, { type: 'leave' });
    game.send(C.sanna, { type: 'leave' });
    expect(game.state.paused).toBe(false);
  });
});

describe('the snapshot', () => {
  it('only the host sees "That\'s me" requests', () => {
    const state = lobbyWithReclaimState();
    expect(buildSnapshot(state, P.mikko).reclaims).toHaveLength(1);
    expect(buildSnapshot(state, P.aino).reclaims).toEqual([]);
  });

  it('a QUESTION snapshot carries the round with the ready list, never the answers', () => {
    const snapshot = buildSnapshot(questionState(), P.ville);
    if (snapshot.phase !== 'QUESTION') throw new Error('expected QUESTION');
    expect(snapshot.round.ready).toEqual([P.aino]);
    expect(snapshot.you.submitted).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain('answers');
    expect(snapshot.round.question.text).toBe(questionState().questions[0]?.text);
  });

  it('welcome snapshots match the fixture shapes (checked for every welcome by apply())', () => {
    const game = session(lobbyState());
    const welcome = only(
      sentTo(game.hello(conn('j'), 9, { nickname: 'Juho' }), conn('j')),
      'welcome',
    );
    expect(Object.keys(welcome.snapshot).sort()).toEqual(
      [
        'gameId',
        'hostId',
        'key',
        'phase',
        'players',
        'questionCounts',
        'reclaims',
        'settings',
        'you',
      ].sort(),
    );
  });
});
