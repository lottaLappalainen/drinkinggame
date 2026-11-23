// S-1…S-7, G-50: the group ranking, the reveal steps and the results of one round.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  averageSpots,
  bordaPoints,
  firstVotes,
  placesFromPoints,
} from '../../../src/game/scoring/borda';
import { revealSteps } from '../../../src/game/scoring/revealSteps';
import { computeResults } from '../../../src/game/scoring/results';
import {
  MIN_ANSWERS_FOR_STATS,
  REVEAL_BUFFER_MS,
  REVEAL_DRUMROLL_MS,
  REVEAL_STEP_MS,
} from '../../../src/shared/constants';
import { RoundResultsSchema, type PlayerId, type RankingEntry } from '../../../src/shared/protocol';
import { P, T0 } from '../../fixtures/common';

const [A, B, C, D, E, F] = [P.mikko, P.aino, P.ville, P.sanna, P.juho, P.emma];

/** GAME_DESCRIPTION §5.1: four voters rank A, B, C, D. */
const EXAMPLE_VOTES = [
  [A, B, C, D],
  [B, A, D, C],
  [A, B, D, C],
  [B, A, C, D],
];

describe('Borda count (S-1…S-4)', () => {
  it('the §5.1 example: A 14, B 14, C 6, D 6', () => {
    const points = bordaPoints([A, B, C, D], EXAMPLE_VOTES);
    expect([...points]).toEqual([
      [A, 14],
      [B, 14],
      [C, 6],
      [D, 6],
    ]);
  });

  it('equal scores share a place and the next place is skipped (S-4)', () => {
    const places = placesFromPoints([A, B, C, D], bordaPoints([A, B, C, D], EXAMPLE_VOTES));
    expect(places).toEqual([
      { playerId: A, place: 1 },
      { playerId: B, place: 1 },
      { playerId: C, place: 3 },
      { playerId: D, place: 3 },
    ]);
  });

  it('1, 1, 3 — a tie at the top skips place 2', () => {
    const points = new Map<PlayerId, number>([
      [A, 9],
      [B, 9],
      [C, 4],
    ]);
    expect(placesFromPoints([A, B, C], points).map((e) => e.place)).toEqual([1, 1, 3]);
  });

  it('ties keep the candidate order (which the server shuffled), best place first', () => {
    const points = new Map<PlayerId, number>([
      [A, 1],
      [B, 5],
      [C, 1],
    ]);
    expect(placesFromPoints([A, B, C], points).map((e) => e.playerId)).toEqual([B, A, C]);
  });

  it('with no votes everybody is tied at place 1', () => {
    expect(placesFromPoints([A, B], bordaPoints([A, B], [])).map((e) => e.place)).toEqual([1, 1]);
  });

  it('average spot and first-place votes (rounded to 2 decimals)', () => {
    const votes = [
      [A, B, C],
      [A, C, B],
      [B, A, C],
    ];
    expect(averageSpots([A, B, C], votes).get(A)).toBe(1.33); // (1 + 1 + 2) / 3
    expect(firstVotes([A, B, C], votes)).toEqual(
      new Map([
        [A, 2],
        [B, 1],
        [C, 0],
      ]),
    );
  });
});

describe('reveal steps (G-50, S-4)', () => {
  const ranking = (places: number[]): RankingEntry[] =>
    places.map((place, i) => ({ playerId: [A, B, C, D, E, F][i] ?? A, place }));
  const kinds = (places: number[]) => revealSteps(ranking(places)).map((s) => s.kind);
  const stepPlaces = (places: number[]) => revealSteps(ranking(places)).map((s) => s.place);

  it('four distinct places: bottom → third → second → top', () => {
    expect(kinds([1, 2, 3, 4])).toEqual(['bottom', 'third', 'second', 'top']);
    expect(stepPlaces([1, 2, 3, 4])).toEqual([4, 3, 2, 1]);
  });

  it('three players: the 3rd place IS the bottom — bottom → second → top', () => {
    expect(kinds([1, 2, 3])).toEqual(['bottom', 'second', 'top']);
  });

  it('two players: bottom → top', () => {
    expect(kinds([1, 2])).toEqual(['bottom', 'top']);
  });

  it('a tie at the top is revealed together and skips the 2nd step ("1, 1, 3")', () => {
    const steps = revealSteps(ranking([1, 1, 3]));
    expect(steps.map((s) => s.kind)).toEqual(['bottom', 'top']);
    expect(steps[1]?.playerIds).toEqual([A, B]);
  });

  it('a tie at 2nd absorbs the 3rd place', () => {
    const steps = revealSteps(ranking([1, 2, 2, 4]));
    expect(steps.map((s) => s.kind)).toEqual(['bottom', 'second', 'top']);
    expect(steps[1]?.playerIds).toEqual([B, C]);
  });

  it('a tie at the last place is one bottom step', () => {
    const steps = revealSteps(ranking([1, 2, 3, 3]));
    expect(steps.map((s) => s.kind)).toEqual(['bottom', 'second', 'top']);
    expect(steps[0]?.playerIds).toEqual([C, D]);
  });

  it('everyone tied: a single top step with everybody (nobody is "last")', () => {
    const steps = revealSteps(ranking([1, 1, 1, 1]));
    expect(steps.map((s) => s.kind)).toEqual(['top']);
    expect(steps[0]?.playerIds).toHaveLength(4);
  });

  it('six players: the places between 3rd and last are not revealed one by one', () => {
    expect(stepPlaces([1, 2, 3, 4, 5, 6])).toEqual([6, 3, 2, 1]);
  });

  it('1, 1, 3, 4 (a tie took the 2nd place): bottom → third → top', () => {
    expect(kinds([1, 1, 3, 4])).toEqual(['bottom', 'third', 'top']);
  });

  it('every step carries the reserved drinking-rule slot, empty until U3', () => {
    for (const step of revealSteps(ranking([1, 2, 3, 4]))) expect(step.rule).toBeNull();
  });

  it('no ranking, no steps', () => {
    expect(revealSteps([])).toEqual([]);
  });
});

describe('results (S-1…S-7)', () => {
  const candidates = [A, B, C, D];
  const answersOf = (votes: readonly (readonly PlayerId[])[]) =>
    Object.fromEntries(votes.map((vote, i) => [`voter${i}`, vote]));
  const results = (votes: readonly (readonly PlayerId[])[]) =>
    computeResults({ roundId: 3, candidates, answers: answersOf(votes), now: T0 });

  it('nobody answered (S-5): nothing to reveal', () => {
    expect(results([])).toEqual({
      roundId: 3,
      outcome: 'nobodyAnswered',
      answerCount: 0,
      revealStartsAt: T0 + REVEAL_BUFFER_MS,
      revealEndsAt: T0 + REVEAL_BUFFER_MS,
    });
  });

  it('one answer is not a group ranking (S-7)', () => {
    const r = results([[A, B, C, D]]);
    expect(r.outcome).toBe('notEnoughAnswers');
    expect(r).not.toHaveProperty('ranking');
    expect(r.revealEndsAt).toBe(r.revealStartsAt);
  });

  it('two answers are enough to rank; stats stay hidden below 5 answers (S-6)', () => {
    const r = results(EXAMPLE_VOTES);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.stats).toBeNull();
    expect(r.ranking.map((e) => e.place)).toEqual([1, 1, 3, 3]);
    expect(r.steps.map((s) => s.kind)).toEqual(['bottom', 'top']);
  });

  it(`stats appear from ${MIN_ANSWERS_FOR_STATS} answers`, () => {
    const four = results(EXAMPLE_VOTES);
    const five = results([...EXAMPLE_VOTES, [A, B, C, D]]);
    expect(four.outcome === 'ranked' && four.stats).toBeNull();
    expect(five.outcome === 'ranked' && five.stats).toEqual([
      { playerId: A, averageSpot: 1.4, firstVotes: 3 },
      { playerId: B, averageSpot: 1.6, firstVotes: 2 },
      { playerId: C, averageSpot: 3.4, firstVotes: 0 },
      { playerId: D, averageSpot: 3.6, firstVotes: 0 },
    ]);
  });

  it('the reveal ends when the shared timing function says so (G-45)', () => {
    const r = results(EXAMPLE_VOTES);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.revealStartsAt).toBe(T0 + REVEAL_BUFFER_MS);
    expect(r.revealEndsAt).toBe(r.revealStartsAt + 2 * REVEAL_STEP_MS + REVEAL_DRUMROLL_MS);
  });

  it('what leaves the server is valid, and never contains points or who voted what (S-6)', () => {
    for (const votes of [[], [[A, B, C, D]], EXAMPLE_VOTES, [...EXAMPLE_VOTES, [D, C, B, A]]]) {
      const r = results(votes);
      expect(v.safeParse(RoundResultsSchema, r).success).toBe(true);
      expect(JSON.stringify(r)).not.toMatch(/points|score|voter/i);
    }
  });
});
