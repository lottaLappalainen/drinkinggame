// Fixtures must stay valid against the protocol AND the invariants — otherwise the client would be
// built against data the server can never send (Phase 2 "Fixture check").
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { checkInvariants, checkSnapshotInvariants } from '../../src/game/invariants';
import { GameStateSchema } from '../../src/game/stateSchema';
import { ServerMessageSchema, SnapshotSchema } from '../../src/shared/protocol';
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

  it('cover every phase', () => {
    const phases = new Set(SCREEN_FIXTURES.map((f) => f.snapshot.phase));
    expect([...phases].sort()).toEqual(['ENDED', 'LOBBY', 'QUESTION', 'RESULTS']);
  });

  for (const fixture of SCREEN_FIXTURES) {
    describe(fixture.name, () => {
      it('matches SnapshotSchema', () => {
        const result = v.safeParse(SnapshotSchema, fixture.snapshot);
        expect(result.success, issues(result)).toBe(true);
      });

      it('satisfies the snapshot invariants', () => {
        expect(checkSnapshotInvariants(fixture.snapshot)).toEqual([]);
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

    it(`${name} satisfies the state invariants`, () => {
      expect(checkInvariants(make())).toEqual([]);
    });
  }
});
