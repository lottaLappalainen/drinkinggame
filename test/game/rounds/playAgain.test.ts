// "Play again" (G-52): after Game Over the host takes the same group back to a fresh lobby — the
// same game object, key, host, players and settings — and the next game avoids the questions this
// group already had. Through the engine with the scripted `session`, so every step also checks the
// invariants, the saved-state schema and every outgoing message (test/game/helpers.ts apply()).
import { describe, expect, it } from 'vitest';
import { ENDED_RETENTION_MS, QUESTION_INTRO_MS } from '../../../src/shared/constants';
import type { ConnId } from '../../../src/shared/protocol';
import { C, GAME_ID, GAME_KEY, P } from '../../fixtures/common';
import { lobbyState } from '../../fixtures/states';
import { broadcasts, conn, only, sentTo, session, types } from '../players/session';
import type { Session } from '../players/session';

const ALL: readonly ConnId[] = [C.mikko, C.aino, C.ville, C.sanna];

/** A game that started, played round 1 (everyone answered), and was ended by the host. */
function endedAfterOneRound(): { game: Session; asked: string[] } {
  const game = session(lobbyState());
  game.send(C.mikko, { type: 'start' });
  game.wait(QUESTION_INTRO_MS);
  const round = game.state.round;
  if (round === null) throw new Error('no round');
  for (const c of ALL)
    game.send(c, { type: 'submit', roundId: round.roundId, ranking: round.candidates });
  const asked = [...game.state.playedQuestionIds];
  game.send(C.mikko, { type: 'end' });
  return { game, asked };
}

const playAgain = (game: Session, who: ConnId = C.mikko) => game.send(who, { type: 'playAgain' });

describe('play again (G-52)', () => {
  it('the host takes everyone back to a fresh lobby: same key, game, host, players, settings', () => {
    const { game } = endedAfterOneRound();
    const settings = structuredClone(game.state.settings);
    const effects = playAgain(game);

    expect(game.state).toMatchObject({
      key: GAME_KEY,
      gameId: GAME_ID, // photo URLs and the phones' saved logins stay valid
      phase: 'LOBBY',
      endReason: null,
      hostId: P.mikko,
      paused: false,
      round: null,
      questions: [],
      settings,
    });
    expect(game.state.deadlines.retention).toBeUndefined(); // no longer deleted 10 min after the end
    expect(Object.keys(game.state.players).sort()).toEqual(
      [P.aino, P.mikko, P.sanna, P.ville].sort(),
    );
    // Nothing is broadcast as a delta: every phone gets its own full lobby snapshot instead.
    expect(broadcasts(effects)).toEqual([]);
    for (const [c, id] of [
      [C.mikko, P.mikko],
      [C.aino, P.aino],
    ] as const) {
      const { snapshot } = only(sentTo(effects, c), 'newGame');
      expect(snapshot).toMatchObject({
        phase: 'LOBBY',
        key: GAME_KEY,
        hostId: P.mikko,
        you: { playerId: id },
      });
      expect(snapshot.players).toHaveLength(4);
    }
  });

  it('per-game counters start over; everyone plays from the first question', () => {
    const { game } = endedAfterOneRound();
    expect(game.state.players[P.aino]?.stats.answered).toBe(1);
    playAgain(game);
    for (const player of Object.values(game.state.players)) {
      expect(player.stats).toEqual({
        timesFirst: 0,
        timesLast: 0,
        answered: 0,
        missed: 0,
        sipsDrunk: 0,
        sipsGiven: 0,
      });
      expect(player).toMatchObject({ timesShown: 0, timesSubject: 0, activeFromRound: 1 });
    }
  });

  it('a player who was offline is still in it and lands in the new lobby on reconnect', () => {
    const { game } = endedAfterOneRound();
    game.close(C.sanna);
    const effects = playAgain(game);
    expect(sentTo(effects, C.sanna)).toEqual([]); // offline: nothing sent
    expect(game.state.players[P.sanna]?.status).toBe('active');

    const back = game.hello(conn('sanna-again'), 4); // Sanna's saved token
    expect(only(sentTo(back, conn('sanna-again')), 'welcome').snapshot).toMatchObject({
      phase: 'LOBBY',
      you: { playerId: P.sanna },
    });
  });

  it('players who left stay out: their phone still hears LEFT', () => {
    const { game } = endedAfterOneRound();
    game.send(C.ville, { type: 'leave' });
    const effects = playAgain(game);
    expect(game.state.players[P.ville]?.status).toBe('left');
    expect(sentTo(effects, C.ville)).toEqual([]);
    const back = game.hello(conn('ville-again'), 3);
    expect(only(sentTo(back, conn('ville-again')), 'error').code).toBe('LEFT');
  });

  it('only the host, and only on Game Over', () => {
    const { game } = endedAfterOneRound();
    expect(only(sentTo(playAgain(game, C.aino), C.aino), 'error')).toMatchObject({
      code: 'NOT_ALLOWED',
      for: 'playAgain',
    });
    expect(game.state.phase).toBe('ENDED');

    const lobby = session(lobbyState());
    expect(only(sentTo(playAgain(lobby), C.mikko), 'error').code).toBe('NOT_ALLOWED');
    expect(lobby.state.phase).toBe('LOBBY');
  });

  it('a second tap (both arriving) is harmless: the lobby is already open', () => {
    const { game } = endedAfterOneRound();
    playAgain(game);
    const again = playAgain(game);
    expect(types(sentTo(again, C.mikko))).toEqual(['error']);
    expect(game.state.phase).toBe('LOBBY');
  });

  it('works until the finished game would have been deleted, not after', () => {
    const { game } = endedAfterOneRound();
    game.wait(ENDED_RETENTION_MS - 1);
    playAgain(game);
    expect(game.state.phase).toBe('LOBBY');
    game.wait(1);
    expect(game.deadline().some((e) => e.kind === 'deleteGame')).toBe(false);
  });

  it('the next game starts normally and skips the questions this group already had', () => {
    const { game, asked } = endedAfterOneRound();
    expect(asked).toHaveLength(1); // only the question really asked counts as played
    playAgain(game);
    const effects = game.send(C.mikko, { type: 'start' });
    expect(types(broadcasts(effects))).toEqual(['roundStarted']);
    const drawn = game.state.questions.map((q) => q.id);
    for (const id of asked) expect(drawn).not.toContain(id);
    expect(game.state.playedQuestionIds).toEqual([...asked, drawn[0]]);
  });
});
