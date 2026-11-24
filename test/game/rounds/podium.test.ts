// G-24, S-8: Podium mode through the engine — everyone shown, each voter fills the top 3. Every
// step also checks the invariants, the saved-state schema and every outgoing message (apply()).
import { describe, expect, it } from 'vitest';
import {
  MIN_ANSWERS_FOR_NO_VOTES_LIST,
  PODIUM_MIN_PLAYERS,
  PODIUM_SPOTS,
  QUESTION_INTRO_MS,
} from '../../../src/shared/constants';
import type { ConnId, PlayerId } from '../../../src/shared/protocol';
import { C, P } from '../../fixtures/common';
import { lobbyState } from '../../fixtures/states';
import { broadcasts, conn, sentTo, session, type Session } from '../players/session';

const PLAYERS = 9;

/** The 4 lobby players + joiners up to PLAYERS, Podium chosen, round 1 open for answers. */
function podiumGame(): { game: Session; conns: ConnId[] } {
  const game = session(lobbyState());
  const conns: ConnId[] = [C.mikko, C.aino, C.ville, C.sanna];
  for (let n = 5; n <= PLAYERS; n++) {
    const c = conn(`p${String(n)}`);
    game.hello(c, 100 + n, { nickname: `P${String(n)}` });
    conns.push(c);
  }
  game.send(C.mikko, {
    type: 'setSettings',
    settings: { gameLength: 15, categories: [], mode: 'podium' },
  });
  game.send(C.mikko, { type: 'start' });
  game.wait(QUESTION_INTRO_MS);
  return { game, conns };
}

function current(game: Session) {
  const round = game.state.round;
  if (round === null) throw new Error('no round');
  return round;
}

const submit = (game: Session, who: ConnId, ranking: readonly PlayerId[]) =>
  game.send(who, { type: 'submit', roundId: current(game).roundId, ranking: [...ranking] });

describe('Podium rounds (G-24)', () => {
  it(`everyone is shown and each voter fills exactly ${String(PODIUM_SPOTS)} spots`, () => {
    expect(PLAYERS).toBeGreaterThanOrEqual(PODIUM_MIN_PLAYERS);
    const { game } = podiumGame();
    const round = current(game);
    expect(round.candidates).toHaveLength(PLAYERS);
    expect(round.spots).toBe(PODIUM_SPOTS);
  });

  it('a ranking with too few, too many or repeated players is refused (G-36)', () => {
    const { game } = podiumGame();
    const [a, b, c, d] = current(game).candidates;
    if (a === undefined || b === undefined || c === undefined || d === undefined)
      throw new Error('too few');
    for (const bad of [[a, b], [a, b, c, d], [a, a, b], current(game).candidates]) {
      expect(sentTo(submit(game, C.aino, bad), C.aino)).toEqual([
        { type: 'error', code: 'INVALID', for: 'submit' },
      ]);
    }
    expect(broadcasts(submit(game, C.aino, [a, b, c]))).toContainEqual({
      type: 'playerReady',
      roundId: current(game).roundId,
      playerId: P.aino,
    });
  });

  it('a whole Podium game plays through; the "No votes" group is never counted as last', () => {
    const { game, conns } = podiumGame();
    for (let n = 1; n <= 15; n++) {
      const round = current(game);
      const [a, b, c] = round.candidates;
      if (a === undefined || b === undefined || c === undefined) throw new Error('too few');
      // Everyone answers the same top 3 → the other six get no votes.
      for (const who of conns) submit(game, who, [a, b, c]);
      const results = current(game).results;
      if (results?.outcome !== 'ranked') throw new Error('expected a ranking');
      expect(results.noVotes).toHaveLength(PLAYERS - PODIUM_SPOTS);
      expect(results.steps.map((s) => s.kind)).toEqual(['third', 'second', 'top']);
      game.wait(results.revealEndsAt - game.now);
      game.send(C.mikko, { type: 'advance', roundId: round.roundId });
      if (n < 15) game.wait(QUESTION_INTRO_MS);
    }
    expect(game.state.phase).toBe('ENDED');
    const stats = Object.values(game.state.players).map((p) => p.stats);
    expect(stats.every((s) => s.timesLast === 0)).toBe(true);
    expect(stats.reduce((sum, s) => sum + s.timesFirst, 0)).toBe(15);
  });

  it(`fewer than ${String(MIN_ANSWERS_FOR_NO_VOTES_LIST)} answers: only the revealed places, no "No votes" list (S-8)`, () => {
    const { game, conns } = podiumGame();
    const [a, b, c] = current(game).candidates;
    if (a === undefined || b === undefined || c === undefined) throw new Error('too few');
    for (const who of conns.slice(0, 2)) submit(game, who, [a, b, c]);
    game.wait(current(game).endsAt - game.now + 1_000); // the rest never answer
    game.deadline();
    const results = current(game).results;
    if (results?.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(results.noVotes).toBeNull();
    expect(results.ranking.map((e) => e.playerId)).toEqual([a, b, c]);
  });
});
