// The "welcome first" check in apply() must actually catch a delta that reaches a socket before its
// own welcome — otherwise every apply() call would "prove" an ordering it never verifies.
import { describe, expect, it } from 'vitest';
import { broadcast, send, toHost } from '../../src/game/effects';
import { buildSnapshot } from '../../src/game/players/view';
import type { ConnId, PlayerId } from '../../src/shared/protocol';
import { C, P, REQUEST_ID } from '../fixtures/common';
import { lobbyState } from '../fixtures/states';
import { welcomeFirstViolations } from './helpers';

const state = lobbyState();

/** The welcome the engine would send to this player's socket. */
function welcomeFor(playerId: PlayerId, connId: ConnId) {
  return send(connId, {
    type: 'welcome',
    playerId,
    gameId: state.gameId,
    snapshot: buildSnapshot(state, playerId),
    serverTime: 1,
  });
}

const welcome = welcomeFor(P.aino, C.aino);
const delta = broadcast({ type: 'hostChanged', hostId: P.aino });

describe('welcomeFirstViolations', () => {
  it('accepts welcome before the delta, and deltas for sockets that get no welcome', () => {
    expect(welcomeFirstViolations(state, [welcome, delta])).toEqual([]);
    expect(welcomeFirstViolations(state, [delta])).toEqual([]);
  });

  it('flags a broadcast that reaches the new socket before its welcome', () => {
    expect(welcomeFirstViolations(state, [delta, welcome])).toHaveLength(1);
  });

  it('respects "except" and flags host-only messages the same way', () => {
    const others = broadcast({ type: 'hostChanged', hostId: P.aino }, [P.aino]);
    expect(welcomeFirstViolations(state, [others, welcome])).toEqual([]);
    const toHostFirst = toHost({ type: 'reclaimClosed', requestId: REQUEST_ID });
    expect(welcomeFirstViolations(state, [toHostFirst, welcomeFor(P.mikko, C.mikko)])).toHaveLength(
      1,
    );
  });
});
