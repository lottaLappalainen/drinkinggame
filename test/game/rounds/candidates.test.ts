// G-15, G-34, G-35: who takes part in a round, and who is ranked.
import { describe, expect, it } from 'vitest';
import { newPlayerId } from '../../../src/game/ids';
import { roundParticipants, selectCandidates } from '../../../src/game/rounds/candidates';
import { createPlayer, type GameState } from '../../../src/game/stateSchema';
import { CANDIDATES_WHEN_MORE, SHOW_ALL_UP_TO } from '../../../src/shared/constants';
import type { PlayerId } from '../../../src/shared/protocol';
import { P, T0 } from '../../fixtures/common';
import { fakeTokenHash, lobbyState } from '../../fixtures/states';
import { seeded } from '../players/session';

/** A game with `count` active players (the lobby's four, then generated ones). */
function gameWith(count: number): { state: GameState; ids: PlayerId[] } {
  const state = lobbyState();
  const random = seeded(count);
  while (Object.keys(state.players).length < count) {
    const id = newPlayerId(random);
    const n = Object.keys(state.players).length + 1;
    state.players[id] = createPlayer({
      nickname: `P${n}`,
      nameKey: `p${n}`,
      presetId: 'fox',
      tokenHash: fakeTokenHash(n),
      now: T0,
      activeFromRound: 1,
    });
  }
  return { state, ids: Object.keys(state.players) as PlayerId[] };
}

describe('who takes part (G-15, G-34)', () => {
  it('active players, online or offline, in join order', () => {
    const { state, ids } = gameWith(4);
    const sanna = state.players[P.sanna];
    if (sanna) sanna.connId = null; // offline: still takes part
    expect(roundParticipants(state, 1)).toEqual(ids);
  });

  it('players who left or were removed are out', () => {
    const { state } = gameWith(4);
    const aino = state.players[P.aino];
    const ville = state.players[P.ville];
    if (aino) aino.status = 'left';
    if (ville) ville.status = 'removed';
    expect(roundParticipants(state, 1)).toEqual([P.mikko, P.sanna]);
  });

  it('a late joiner takes part from their first round, not before (G-15)', () => {
    const { state } = gameWith(4);
    const late = state.players[P.sanna];
    if (late) late.activeFromRound = 3;
    expect(roundParticipants(state, 2)).not.toContain(P.sanna);
    expect(roundParticipants(state, 3)).toContain(P.sanna);
  });
});

describe('who is ranked (G-34)', () => {
  it(`up to ${SHOW_ALL_UP_TO} players: everybody, in a random order`, () => {
    for (const count of [3, 4, SHOW_ALL_UP_TO]) {
      const { state, ids } = gameWith(count);
      const shown = selectCandidates(state, ids, seeded(count));
      expect([...shown].sort()).toEqual([...ids].sort());
    }
  });

  it(`${SHOW_ALL_UP_TO + 1} players: exactly ${CANDIDATES_WHEN_MORE} — the drop is the rule, not a bug`, () => {
    const { state, ids } = gameWith(SHOW_ALL_UP_TO + 1);
    const shown = selectCandidates(state, ids, seeded(1));
    expect(shown).toHaveLength(CANDIDATES_WHEN_MORE);
    expect(new Set(shown).size).toBe(CANDIDATES_WHEN_MORE);
    for (const id of shown) expect(ids).toContain(id);
  });

  it('25 players: still exactly the same number', () => {
    const { state, ids } = gameWith(25);
    expect(selectCandidates(state, ids, seeded(3))).toHaveLength(CANDIDATES_WHEN_MORE);
  });

  it('the order is random too: nobody is always first on the list', () => {
    const { state, ids } = gameWith(4);
    const random = seeded(11);
    const firsts = new Set<PlayerId | undefined>();
    for (let i = 0; i < 60; i++) firsts.add(selectCandidates(state, ids, random)[0]);
    expect(firsts.size).toBe(4);
  });
});

describe('fair selection over a game (G-35)', () => {
  it('nobody is shown more than once more than anybody else, and everybody appears', () => {
    for (const count of [7, 8, 11, 25]) {
      const { state, ids } = gameWith(count);
      const random = seeded(count * 17);
      for (let round = 0; round < 120; round++) {
        for (const id of selectCandidates(state, ids, random)) {
          const player = state.players[id];
          if (player) player.timesShown += 1;
        }
        const shown = ids.map((id) => state.players[id]?.timesShown ?? 0);
        expect(Math.max(...shown) - Math.min(...shown)).toBeLessThanOrEqual(1);
      }
      expect(Math.min(...ids.map((id) => state.players[id]?.timesShown ?? 0))).toBeGreaterThan(0);
    }
  });

  it('the least-shown players are always picked first, ties are random', () => {
    const { state, ids } = gameWith(8);
    ids.forEach((id, i) => {
      const player = state.players[id];
      if (player) player.timesShown = i < 3 ? 0 : 5; // three players were never shown
    });
    const random = seeded(4);
    const tail = new Set<PlayerId>();
    for (let i = 0; i < 40; i++) {
      const shown = selectCandidates(state, ids, random);
      for (const never of ids.slice(0, 3)) expect(shown).toContain(never);
      for (const id of shown) if (!ids.slice(0, 3).includes(id)) tail.add(id);
    }
    expect(tail.size).toBe(5); // the 2 open places were filled randomly from all 5 others
  });
});
