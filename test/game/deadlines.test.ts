import { describe, expect, it } from 'vitest';
import { idleCleanupAt, nextDeadline } from '../../src/game/deadlines';
import { IDLE_LOBBY_MS, IDLE_STARTED_MS } from '../../src/shared/constants';
import { T0 } from '../fixtures/common';
import { endedState, lobbyState, lobbyWithReclaimState, questionState } from '../fixtures/states';

describe('nextDeadline — the single place that knows every game deadline', () => {
  it('a lobby with everyone online has no deadline', () => {
    expect(nextDeadline(lobbyState())).toBeNull();
  });

  it('a running round: the round-end deadline', () => {
    const state = questionState();
    expect(nextDeadline(state)).toBe(state.deadlines.roundEnd);
  });

  it('picks the earliest of several deadlines', () => {
    const state = questionState();
    state.deadlines.hostHandover = (state.deadlines.roundEnd ?? 0) - 1;
    expect(nextDeadline(state)).toBe(state.deadlines.hostHandover);
  });

  it('includes reclaim expiries (stored on each request)', () => {
    const state = lobbyWithReclaimState();
    expect(nextDeadline(state)).toBe(T0 + 360_000);
  });

  it('includes retention for an ended game', () => {
    const state = endedState();
    expect(nextDeadline(state)).toBe(state.deadlines.retention);
  });
});

describe('idle cleanup (§10: 30 min lobby / 3 h started)', () => {
  it('is measured from idleSince, by phase', () => {
    const lobby = lobbyState();
    lobby.idleSince = T0;
    expect(idleCleanupAt(lobby)).toBe(T0 + IDLE_LOBBY_MS);
    expect(nextDeadline(lobby)).toBe(T0 + IDLE_LOBBY_MS);

    const started = questionState();
    started.idleSince = T0;
    started.deadlines = {};
    expect(idleCleanupAt(started)).toBe(T0 + IDLE_STARTED_MS);
  });

  it('does not apply while someone is online, nor to ended games (retention does)', () => {
    expect(idleCleanupAt(lobbyState())).toBeNull();
    const ended = endedState();
    ended.idleSince = T0;
    expect(idleCleanupAt(ended)).toBeNull();
  });
});
