// checkInvariants must catch each kind of broken state — otherwise running it after every event
// in Phase 3 would prove nothing. Each case breaks exactly one rule in a valid fixture.
import { describe, expect, it } from 'vitest';
import { checkInvariants, checkSnapshotInvariants } from '../../src/game/invariants';
import type { GameState } from '../../src/game/stateSchema';
import { C, P, REQUEST_ID, connId } from '../fixtures/common';
import { SCREEN_FIXTURES } from '../fixtures/snapshots';
import { lobbyState, lobbyWithReclaimState, questionState } from '../fixtures/states';

function broken(make: () => GameState, breakIt: (s: GameState) => void): string[] {
  const state = make();
  breakIt(state);
  return checkInvariants(state);
}

describe('checkInvariants catches', () => {
  const cases: ReadonlyArray<readonly [string, () => GameState, (s: GameState) => void]> = [
    [
      'a player pointing at a connection bound to someone else',
      lobbyState,
      (s) => {
        const aino = s.players[P.aino];
        if (aino) aino.connId = C.ville;
      },
    ],
    [
      'a connection bound to an unknown player',
      lobbyState,
      (s) => {
        s.connections[connId('conn-x')] = { playerId: P.juho, protocolVersion: 1 };
      },
    ],
    [
      'a connection that is both player and requester',
      lobbyWithReclaimState,
      (s) => {
        s.connections[C.aino] = {
          playerId: P.aino,
          reclaimRequestId: REQUEST_ID,
          protocolVersion: 1,
        };
      },
    ],
    [
      'online flags that disagree',
      lobbyState,
      (s) => {
        const aino = s.players[P.aino];
        if (aino) aino.offlineSince = 1;
      },
    ],
    [
      'a candidate who is not a participant of the round',
      questionState,
      (s) => {
        if (s.round) s.round.participants = s.round.participants.filter((id) => id !== P.ville);
      },
    ],
    [
      'an ended game that still holds a round (its answers)',
      questionState,
      (s) => {
        s.phase = 'ENDED';
        s.endReason = 'finished';
        s.deadlines = { retention: 1 };
      },
    ],
    [
      'a host who is not active',
      lobbyState,
      (s) => {
        const mikko = s.players[P.mikko];
        if (mikko) mikko.status = 'left';
      },
    ],
    [
      'a pending reclaim for a player who left',
      lobbyWithReclaimState,
      (s) => {
        const sanna = s.players[P.sanna];
        if (sanna) sanna.status = 'left';
      },
    ],
    [
      'a round in the lobby',
      questionState,
      (s) => {
        s.phase = 'LOBBY';
      },
    ],
    [
      'a question without its round-end deadline',
      questionState,
      (s) => {
        delete s.deadlines.roundEnd;
      },
    ],
    [
      'an answer from a non-participant',
      questionState,
      (s) => {
        if (s.round) s.round.participants = [P.mikko, P.ville, P.sanna];
      },
    ],
    [
      'an answer that is not a ranking of the candidates',
      questionState,
      (s) => {
        if (s.round) s.round.answers[P.aino] = [P.ville, P.ville, P.sanna, P.aino];
      },
    ],
    [
      'a question drawn twice (G-31)',
      questionState,
      (s) => {
        const first = s.questions[0];
        if (first) s.questions[1] = { ...first };
      },
    ],
    [
      'endReason outside ENDED',
      lobbyState,
      (s) => {
        s.endReason = 'finished';
      },
    ],
    [
      'idleSince while players are online',
      lobbyState,
      (s) => {
        s.idleSince = 1;
      },
    ],
    [
      'two active players with the same name (G-14)',
      lobbyState,
      (s) => {
        const aino = s.players[P.aino];
        if (aino) aino.nameKey = 'mikko';
      },
    ],
  ];

  for (const [name, make, breakIt] of cases) {
    it(name, () => {
      expect(broken(make, breakIt)).not.toEqual([]);
    });
  }

  it('…but accepts a replaced socket that still points at its player (G-18)', () => {
    const state = lobbyState();
    state.connections[connId('conn-aino-old')] = { playerId: P.aino, protocolVersion: 1 };
    expect(checkInvariants(state)).toEqual([]);
  });

  it('…and a candidate who left during the round — still rankable (G-41)', () => {
    const state = questionState();
    const sanna = state.players[P.sanna];
    if (sanna) {
      delete state.connections[C.sanna];
      state.players[P.sanna] = {
        ...sanna,
        status: 'left',
        connId: null,
        connectedSince: null,
        offlineSince: 1,
      };
    }
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('checkSnapshotInvariants catches', () => {
  const resultsFixture = SCREEN_FIXTURES.find((f) => f.name === 'results-done-host');

  it('results that belong to another round', () => {
    const snapshot = resultsFixture?.snapshot;
    if (snapshot?.phase !== 'RESULTS') throw new Error('fixture missing');
    const wrong = { ...snapshot, results: { ...snapshot.results, roundId: 99 } };
    expect(checkSnapshotInvariants(wrong)).not.toEqual([]);
  });

  it('reclaim requests sent to a non-host', () => {
    const fixture = SCREEN_FIXTURES.find((f) => f.name === 'lobby-reclaim-pending');
    if (fixture?.snapshot.phase !== 'LOBBY') throw new Error('fixture missing');
    const wrong = { ...fixture.snapshot, you: { playerId: P.aino } };
    expect(checkSnapshotInvariants(wrong)).not.toEqual([]);
  });
});
