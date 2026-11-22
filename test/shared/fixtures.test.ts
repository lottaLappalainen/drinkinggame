// Fixtures must stay valid against the protocol — otherwise the client would be built against
// data the server can never send (Phase 2 "Fixture check").
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '../../src/game/stateSchema';
import { MIN_ANSWERS_FOR_STATS } from '../../src/shared/constants';
import { ServerMessageSchema, SnapshotSchema } from '../../src/shared/protocol';
import { revealEndsAt } from '../../src/shared/reveal';
import { MESSAGE_FIXTURES } from '../fixtures/messages';
import { SCREEN_FIXTURES } from '../fixtures/snapshots';
import { STATE_FIXTURES } from '../fixtures/states';

function issues(result: v.SafeParseResult<v.GenericSchema>): string {
  return result.success ? '' : JSON.stringify(v.flatten(result.issues));
}

describe('screen fixtures', () => {
  it('have unique names', () => {
    const names = SCREEN_FIXTURES.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const fixture of SCREEN_FIXTURES) {
    describe(fixture.name, () => {
      const { snapshot } = fixture;

      it('matches SnapshotSchema', () => {
        const result = v.safeParse(SnapshotSchema, snapshot);
        expect(result.success, issues(result)).toBe(true);
      });

      it('is internally consistent', () => {
        const ids = new Set(snapshot.players.map((p) => p.playerId));
        expect(ids.has(snapshot.you.playerId)).toBe(true);
        if (snapshot.hostId !== null) expect(ids.has(snapshot.hostId)).toBe(true);
        // Only the host ever receives reclaim requests.
        if (snapshot.reclaims.length > 0) expect(snapshot.you.playerId).toBe(snapshot.hostId);

        const round = snapshot.round;
        if (round) {
          for (const id of [...round.candidates, ...round.participants])
            expect(ids.has(id)).toBe(true);
          for (const id of round.ready) expect(round.participants).toContain(id);
          expect(round.endsAt).toBeGreaterThan(round.answerStartsAt);
        }

        const results = snapshot.results;
        if (results) {
          expect(snapshot.phase).toBe('RESULTS');
          expect(results.revealEndsAt).toBe(
            revealEndsAt(results.revealStartsAt, results.steps.length),
          );
          if (results.outcome !== 'ranked') {
            expect(results.ranking).toEqual([]);
            expect(results.steps).toEqual([]);
          }
          if (results.stats !== null)
            expect(results.answerCount).toBeGreaterThanOrEqual(MIN_ANSWERS_FOR_STATS);
          for (const step of results.steps) expect(step.rule).toBeNull();
        }
      });
    });
  }
});

describe('message fixtures', () => {
  for (const fixture of MESSAGE_FIXTURES) {
    it(`${fixture.name} matches ServerMessageSchema`, () => {
      const result = v.safeParse(ServerMessageSchema, fixture.message);
      expect(result.success, issues(result)).toBe(true);
    });
  }
});

describe('state fixtures', () => {
  for (const [name, make] of STATE_FIXTURES) {
    it(`${name} matches GameStateSchema`, () => {
      const result = v.safeParse(GameStateSchema, make());
      expect(result.success, issues(result)).toBe(true);
    });
  }
});
