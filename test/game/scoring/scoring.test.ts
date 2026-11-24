// S-1…S-8, G-50: the group ranking, the reveal steps and the results of one round — Spotlight
// (everyone shown is ranked) and Podium (top 3 of everyone), which differ only in the spot count.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { bordaPoints, placesFromPoints } from '../../../src/game/scoring/borda';
import { revealSteps } from '../../../src/game/scoring/revealSteps';
import { computeResults } from '../../../src/game/scoring/results';
import {
  MIN_ANSWERS_FOR_NO_VOTES_LIST,
  REVEAL_BUFFER_MS,
  REVEAL_DRUMROLL_MS,
  REVEAL_STEP_MS,
} from '../../../src/shared/constants';
import { RoundResultsSchema, type PlayerId, type RankingEntry } from '../../../src/shared/protocol';
import { P, T0, guestId } from '../../fixtures/common';

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
    const points = bordaPoints([A, B, C, D], EXAMPLE_VOTES, 4);
    expect([...points]).toEqual([
      [A, 14],
      [B, 14],
      [C, 6],
      [D, 6],
    ]);
  });

  it('equal scores share a place and the next place is skipped (S-4)', () => {
    const places = placesFromPoints([A, B, C, D], bordaPoints([A, B, C, D], EXAMPLE_VOTES, 4));
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
    expect(placesFromPoints([A, B], bordaPoints([A, B], [], 2)).map((e) => e.place)).toEqual([
      1, 1,
    ]);
  });

  it('Podium (S-8): 3 spots worth 3 / 2 / 1, everyone unplaced gets 0', () => {
    const points = bordaPoints(
      [A, B, C, D, E, F],
      [
        [A, B, C],
        [B, A, D],
      ],
      3,
    );
    expect([...points]).toEqual([
      [A, 5],
      [B, 5],
      [C, 1],
      [D, 1],
      [E, 0],
      [F, 0],
    ]);
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

  it('a partial ranking (Podium) never reveals a bottom step — not even 3rd as "least" (G-50)', () => {
    const partial = (places: number[]) => revealSteps(ranking(places), false).map((s) => s.kind);
    expect(partial([1, 2, 3, 4])).toEqual(['third', 'second', 'top']);
    expect(partial([1, 2, 3])).toEqual(['third', 'second', 'top']);
    expect(partial([1, 2])).toEqual(['second', 'top']);
    expect(partial([1, 1, 3])).toEqual(['third', 'top']);
    expect(partial([1, 1, 1])).toEqual(['top']);
  });
});

describe('results (S-1…S-7)', () => {
  const candidates = [A, B, C, D];
  const answersOf = (votes: readonly (readonly PlayerId[])[]) =>
    Object.fromEntries(votes.map((vote, i) => [`voter${i}`, vote]));
  const results = (votes: readonly (readonly PlayerId[])[]) =>
    computeResults({ roundId: 3, candidates, spots: 4, answers: answersOf(votes), now: T0 });

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

  it('two answers are enough to rank; a full ranking lists everyone and has no "No votes" group', () => {
    const r = results(EXAMPLE_VOTES);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.ranking.map((e) => e.place)).toEqual([1, 1, 3, 3]);
    expect(r.noVotes).toEqual([]);
    expect(r.steps.map((s) => s.kind)).toEqual(['bottom', 'top']);
  });

  it('places only — no vote counts or average spot, however many answered (S-6)', () => {
    const many = results([...EXAMPLE_VOTES, ...EXAMPLE_VOTES]);
    expect(Object.keys(many).sort()).toEqual(
      [
        'answerCount',
        'noVotes',
        'outcome',
        'ranking',
        'revealEndsAt',
        'revealStartsAt',
        'roundId',
        'steps',
      ].sort(),
    );
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
      expect(JSON.stringify(r)).not.toMatch(/points|score|voter|average|firstVotes/i);
    }
  });
});

describe('Podium results (G-24, S-8, G-50)', () => {
  const twelve = [A, B, C, D, E, F, ...[7, 8, 9, 10, 11, 12].map(guestId)];
  const podium = (votes: readonly (readonly PlayerId[])[], candidates = twelve) =>
    computeResults({
      roundId: 4,
      candidates,
      spots: Math.min(3, candidates.length),
      answers: Object.fromEntries(votes.map((vote, i) => [`voter${String(i)}`, vote])),
      now: T0,
    });
  const FIVE_VOTES = [
    [A, B, C],
    [A, C, B],
    [B, A, D],
    [A, B, E],
    [C, A, B],
  ];

  it(`with ${String(MIN_ANSWERS_FOR_NO_VOTES_LIST)}+ answers: places for those with points, everyone else in "No votes"`, () => {
    const r = podium(FIVE_VOTES);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    // A 3+3+2+3+2 = 13, B 2+1+3+2+1 = 9, C 1+2+3 = 6, D 1, E 1
    expect(r.ranking).toEqual([
      { playerId: A, place: 1 },
      { playerId: B, place: 2 },
      { playerId: C, place: 3 },
      { playerId: D, place: 4 },
      { playerId: E, place: 4 },
    ]);
    expect(r.noVotes).toEqual([F, ...[7, 8, 9, 10, 11, 12].map(guestId)]);
    expect(r.steps.map((s) => [s.kind, s.place])).toEqual([
      ['third', 3],
      ['second', 2],
      ['top', 1],
    ]);
    expect(v.safeParse(RoundResultsSchema, r).success).toBe(true);
  });

  it('with fewer answers only the revealed places are sent — who got points stays hidden (S-8)', () => {
    const r = podium(FIVE_VOTES.slice(0, MIN_ANSWERS_FOR_NO_VOTES_LIST - 1));
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.noVotes).toBeNull();
    const revealed = r.steps.flatMap((s) => s.playerIds).sort();
    expect(r.ranking.map((e) => e.playerId).sort()).toEqual(revealed);
    expect(r.ranking.every((e) => e.place <= 3)).toBe(true);
  });

  it('big ties: 3 voters with no overlapping picks → nine players in three-way ties', () => {
    const g = [7, 8, 9, 10, 11, 12].map(guestId);
    const r = podium([
      [A, B, C],
      [D, E, F],
      [g[0] ?? A, g[1] ?? A, g[2] ?? A],
    ]);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.steps.map((s) => [s.kind, s.playerIds.length])).toEqual([['top', 3]]);
    expect(r.ranking).toHaveLength(3); // fewer than 5 answers: only the revealed top
  });

  it('Podium down to 3 players: everyone is placed, so it is exactly Spotlight (bottom step included)', () => {
    const votes = [
      [A, B, C],
      [A, C, B],
    ];
    const asPodium = podium(votes, [A, B, C]);
    const asSpotlight = computeResults({
      roundId: 4,
      candidates: [A, B, C],
      spots: 3,
      answers: Object.fromEntries(votes.map((vote, i) => [`voter${String(i)}`, vote])),
      now: T0,
    });
    expect(asPodium).toEqual(asSpotlight);
    if (asPodium.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(asPodium.steps[0]?.kind).toBe('bottom');
    expect(asPodium.noVotes).toEqual([]);
  });
});
