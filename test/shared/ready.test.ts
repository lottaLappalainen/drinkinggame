// The ready counter and "waiting for the next round" — one definition for server and phones.
import { describe, expect, it } from 'vitest';
import { canEndEarly, isWaitingForNextRound, readyCounter } from '../../src/shared/ready';
import { P } from '../fixtures/common';

describe('readyCounter / canEndEarly (G-38, G-39)', () => {
  it('counts online or ready participants; offline players who did not answer are not waited for', () => {
    const online = new Set([P.mikko, P.aino]);
    const counter = readyCounter([P.mikko, P.aino, P.ville], new Set([P.aino, P.ville]), (id) =>
      online.has(id),
    );
    expect(counter).toEqual({ ready: 2, total: 3 });
    expect(canEndEarly(10, 5, { ready: 0, total: 0 })).toBe(false); // nobody to wait for
    expect(canEndEarly(4, 5, { ready: 1, total: 1 })).toBe(false); // still in the intro
    expect(canEndEarly(5, 5, { ready: 1, total: 1 })).toBe(true);
  });
});

describe('isWaitingForNextRound (G-15, G-19)', () => {
  const round = { participants: [P.mikko, P.aino] };

  it('an active player who is not taking part in the round on screen is waiting', () => {
    expect(isWaitingForNextRound(P.ville, 'active', round)).toBe(true);
    expect(isWaitingForNextRound(P.aino, 'active', round)).toBe(false);
  });

  it('never in the lobby or after the game (no round), never for players who left', () => {
    expect(isWaitingForNextRound(P.ville, 'active', null)).toBe(false);
    expect(isWaitingForNextRound(P.ville, 'left', round)).toBe(false);
  });
});
