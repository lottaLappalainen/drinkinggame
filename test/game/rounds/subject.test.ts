// "[player]" questions (G-51, Q-10): the subject is picked fairly, left off the list to rank, and
// with too few players the question swaps with the next regular one.
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../../src/game/invariants';
import { publicRound } from '../../../src/game/players/view';
import { startRound } from '../../../src/game/rounds/round';
import { pickSubject } from '../../../src/game/rounds/subject';
import type { GameState } from '../../../src/game/stateSchema';
import { SUBJECT_MIN_RANKABLE } from '../../../src/shared/constants';
import type { PlayerId, Question } from '../../../src/shared/protocol';
import { P } from '../../fixtures/common';
import { lobbyState } from '../../fixtures/states';
import { seeded } from '../players/session';

const regular = (n: number): Question => ({
  id: `r${String(n)}`,
  text: `Who is most likely to do thing ${String(n)}?`,
  category: 'default',
  labels: 'likely',
});
const about = (n: number): Question => ({
  id: `s${String(n)}`,
  text: `Who is the closest to [player] ${String(n)}?`,
  category: 'default',
  labels: 'most',
});

const LENGTH = 15;

/**
 * A started game (4 players) whose question list starts with `questions`, padded to the game length
 * with `pad` questions; round `roundId` not started yet.
 */
function game(
  questions: Question[],
  leave: readonly PlayerId[] = [],
  pad: (n: number) => Question = regular,
): GameState {
  const state = lobbyState();
  state.settings.gameLength = LENGTH;
  state.questions = [
    ...questions,
    ...Array.from({ length: LENGTH - questions.length }, (_, i) => pad(100 + i)),
  ];
  for (const id of leave) {
    const player = state.players[id];
    if (!player) continue;
    // Leaving drops the player's socket too (G-41).
    if (player.connId !== null) delete state.connections[player.connId];
    player.status = 'left';
    player.connId = null;
    player.connectedSince = null;
    player.offlineSince = 0;
  }
  return state;
}

function start(state: GameState, roundId = 1, seed = 1) {
  startRound(state, { now: 1_000_000, random: seeded(seed) }, roundId);
  expect(checkInvariants(state)).toEqual([]);
  const round = state.round;
  if (round === null) throw new Error('no round');
  return round;
}

describe('questions about a player (G-51)', () => {
  it('a regular question has no subject', () => {
    const round = start(game([regular(1), about(2)]));
    expect(round.subjectId).toBeNull();
  });

  it(`with ${String(SUBJECT_MIN_RANKABLE)}+ players the subject is picked and left off the list to rank`, () => {
    const state = game([about(1), regular(2)]);
    const round = start(state);
    const subject = round.subjectId;
    if (subject === null) throw new Error('expected a subject');
    expect(round.participants).toContain(subject);
    expect(round.candidates).not.toContain(subject);
    expect(round.candidates).toHaveLength(round.participants.length - 1);
    expect(state.players[subject]?.timesSubject).toBe(1);
    // Phones get the subject; the question text keeps the token (the phone puts the name in).
    expect(publicRound(state, round)).toMatchObject({ subjectId: subject });
    expect(publicRound(state, round).question.text).toContain('[player]');
  });

  it('the subject still answers like everyone else (G-51, unsure default)', () => {
    const round = start(game([about(1)]));
    expect(round.participants).toHaveLength(4);
  });

  it('is fair: everyone is the subject once before anyone is picked twice', () => {
    const state = game([about(1)]);
    const participants = [P.mikko, P.aino, P.ville, P.sanna];
    const picks: PlayerId[] = [];
    const random = seeded(7);
    for (let i = 0; i < 8; i++) {
      const picked = pickSubject(state, participants, random);
      if (picked === null) throw new Error('nobody picked');
      picks.push(picked);
      const player = state.players[picked];
      if (player) player.timesSubject += 1;
    }
    expect(new Set(picks.slice(0, 4)).size).toBe(4);
    expect(new Set(picks.slice(4)).size).toBe(4);
  });

  it('the subject is random among the least-picked (not always the same player)', () => {
    const subjects = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seed) => start(game([about(1)]), 1, seed).subjectId),
    );
    expect(subjects.size).toBeGreaterThan(1);
  });

  it('with only 3 players it swaps with the next regular question (no ranking of just 2)', () => {
    const state = game([about(1), about(2), regular(3), regular(4)], [P.sanna]);
    const round = start(state);
    expect(round.subjectId).toBeNull();
    expect(state.questions.slice(0, 4).map((q) => q.id)).toEqual(['r3', 's2', 's1', 'r4']);
    expect(round.candidates).toHaveLength(3);
  });

  it('with only 3 players and no regular question left, the subject is ranked too', () => {
    const state = game([], [P.sanna], about);
    const round = start(state);
    const subject = round.subjectId;
    expect(subject).not.toBeNull();
    expect(round.candidates).toHaveLength(3);
    expect(round.candidates).toContain(subject);
  });

  it('later rounds pick a subject too (the swap only looks forward)', () => {
    const state = game([regular(1), about(2), regular(3)]);
    start(state, 1);
    state.phase = 'RESULTS';
    const round = start(state, 2);
    expect(round.subjectId).not.toBeNull();
    expect(state.questions[1]?.id).toBe('s2');
  });
});
