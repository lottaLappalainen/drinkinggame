// Drinking rules (D-1…D-9): the server draws one number per reveal step from that step's range.
import { describe, expect, it } from 'vitest';
import { computeResults } from '../../../src/game/scoring/results';
import { withDrinkRules } from '../../../src/game/scoring/drinks';
import { QUESTION_INTRO_MS } from '../../../src/shared/constants';
import { DRINK_RULES, MAX_SIPS, drawSips, inRange } from '../../../src/shared/drinkRules';
import type { PlayerId, RevealStep } from '../../../src/shared/protocol';
import { C, P, guestId } from '../../fixtures/common';
import { lobbyState } from '../../fixtures/states';
import { seeded, session } from '../players/session';

const KINDS = ['bottom', 'third', 'second', 'top'] as const;

describe('the rule table (D-1)', () => {
  it('last place drinks 2–8, 3rd 1–3, 2nd 2–4, 1st gives out 1–10', () => {
    expect(DRINK_RULES).toEqual({
      bottom: { action: 'drink', min: 2, max: 8 },
      third: { action: 'drink', min: 1, max: 3 },
      second: { action: 'drink', min: 2, max: 4 },
      top: { action: 'give', min: 1, max: 10 },
    });
    expect(MAX_SIPS).toBe(10);
  });

  it('draws whole numbers that reach both ends of each range and nothing outside', () => {
    const random = seeded(3);
    for (const kind of KINDS) {
      const range = DRINK_RULES[kind];
      const seen = new Set<number>();
      for (let i = 0; i < 2_000; i++) {
        const sips = drawSips(range, random);
        expect(inRange(range, sips)).toBe(true);
        seen.add(sips);
      }
      expect(seen.size).toBe(range.max - range.min + 1);
    }
    // The extremes of the random source map to the ends of the range.
    expect(drawSips(DRINK_RULES.top, () => 0)).toBe(1);
    expect(drawSips(DRINK_RULES.top, () => 0.999_999)).toBe(10);
  });
});

describe('rules on the reveal steps (D-2…D-5)', () => {
  const [A, B, C2, D] = [P.mikko, P.aino, P.ville, P.sanna];
  const answers = (votes: readonly (readonly PlayerId[])[]) =>
    Object.fromEntries(votes.map((vote, i) => [`voter${String(i)}`, vote]));
  const results = (candidates: readonly PlayerId[], spots: number, votes: PlayerId[][]) =>
    computeResults({
      roundId: 1,
      candidates,
      spots,
      answers: answers(votes),
      now: 0,
      random: seeded(11),
    });

  it('every step gets its kind’s rule; a tie shares one number (D-3)', () => {
    const r = results([A, B, C2, D], 4, [
      [A, B, C2, D],
      [B, A, D, C2],
    ]);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    for (const step of r.steps) {
      const range = DRINK_RULES[step.kind];
      expect(step.rule?.action).toBe(range.action);
      expect(inRange(range, step.rule?.sips ?? 0)).toBe(true);
    }
    // A and B tie at 1st: one step, one number for both.
    const top = r.steps.find((step) => step.kind === 'top');
    expect(top?.playerIds).toHaveLength(2);
  });

  it('3 shown: the 3rd is the last place → the last-place rule, no 3rd rule (D-4)', () => {
    const r = results([A, B, C2], 3, [
      [A, B, C2],
      [A, B, C2],
    ]);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.steps.map((step) => [step.kind, step.rule?.action])).toEqual([
      ['bottom', 'drink'],
      ['second', 'drink'],
      ['top', 'give'],
    ]);
  });

  it('Podium with unplaced players: top three only, nobody in "No votes" drinks (D-5)', () => {
    const twelve = [A, B, C2, D, ...[5, 6, 7, 8, 9, 10, 11, 12].map(guestId)];
    const r = results(twelve, 3, [
      [A, B, C2],
      [A, C2, B],
    ]);
    if (r.outcome !== 'ranked') throw new Error('expected a ranking');
    expect(r.steps.map((step) => step.kind)).not.toContain('bottom');
    const ruled = new Set(r.steps.flatMap((step) => step.playerIds));
    for (const id of r.noVotes ?? []) expect(ruled.has(id)).toBe(false);
  });

  it('no rules without a ranking (D-8)', () => {
    expect(results([A, B, C2], 3, [[A, B, C2]]).outcome).toBe('notEnoughAnswers');
    expect(results([A, B, C2], 3, []).outcome).toBe('nobodyAnswered');
  });

  it('withDrinkRules keeps everything else about the steps', () => {
    const steps: RevealStep[] = [{ kind: 'top', place: 1, playerIds: [A], rule: null }];
    expect(withDrinkRules(steps, () => 0)).toEqual([
      { kind: 'top', place: 1, playerIds: [A], rule: { action: 'give', sips: 1 } },
    ]);
  });
});

describe('sips are counted per player (D-9)', () => {
  it('drinkers add their sips to sipsDrunk, place 1 to sipsGiven — and never on the wire', () => {
    const game = session(lobbyState());
    game.send(C.mikko, { type: 'start' });
    game.wait(QUESTION_INTRO_MS);
    const round = game.state.round;
    if (round === null) throw new Error('no round');
    for (const c of [C.mikko, C.aino, C.ville, C.sanna])
      game.send(c, { type: 'submit', roundId: round.roundId, ranking: [...round.candidates] });
    const results = game.state.round?.results;
    if (results?.outcome !== 'ranked') throw new Error('expected a ranking');

    const expected = new Map<PlayerId, { drunk: number; given: number }>();
    for (const step of results.steps)
      for (const id of step.playerIds) {
        const sum = expected.get(id) ?? { drunk: 0, given: 0 };
        if (step.rule?.action === 'drink') sum.drunk += step.rule.sips;
        if (step.rule?.action === 'give') sum.given += step.rule.sips;
        expected.set(id, sum);
      }
    expect(expected.size).toBeGreaterThan(0);
    for (const [id, player] of Object.entries(game.state.players)) {
      const want = expected.get(id as PlayerId) ?? { drunk: 0, given: 0 };
      expect([player.stats.sipsDrunk, player.stats.sipsGiven]).toEqual([want.drunk, want.given]);
    }
  });
});
