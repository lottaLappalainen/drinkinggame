import { describe, expect, it } from 'vitest';
import { ANSWER_GRACE_MS } from '../../src/shared/constants';
import { acceptsAnswers, roundCloseDeadline, roundStep } from '../../src/shared/timeline';
import { canEndEarly, readyCounter } from '../../src/shared/ready';

const ROUND = { answerStartsAt: 10_000, endsAt: 40_000 };

describe('roundStep (G-49, G-38)', () => {
  it('shows the question only during the intro, even if somehow submitted', () => {
    expect(roundStep(9_999, ROUND, false)).toBe('intro');
    expect(roundStep(9_999, ROUND, true)).toBe('intro');
  });

  it('answering, then waiting once this player is ready', () => {
    expect(roundStep(10_000, ROUND, false)).toBe('answering');
    expect(roundStep(20_000, ROUND, true)).toBe('waiting');
  });

  it('closed when time is up without an answer', () => {
    expect(roundStep(40_000, ROUND, false)).toBe('closed');
    expect(roundStep(40_000, ROUND, true)).toBe('waiting');
  });
});

describe('acceptsAnswers (G-39 grace)', () => {
  it('rejects answers during the intro', () => {
    expect(acceptsAnswers(9_999, ROUND)).toBe(false);
  });

  it('accepts last-moment answers within the grace period', () => {
    expect(acceptsAnswers(40_000 + ANSWER_GRACE_MS, ROUND)).toBe(true);
    expect(acceptsAnswers(40_000 + ANSWER_GRACE_MS + 1, ROUND)).toBe(false);
  });

  it('the round-end deadline is endsAt + grace, so the grace actually exists', () => {
    expect(roundCloseDeadline(ROUND)).toBe(40_000 + ANSWER_GRACE_MS);
  });
});

describe('readyCounter — one definition for G-38 and G-39', () => {
  const participants = ['a', 'b', 'c', 'd'];
  const online = new Set(['a', 'b', 'c']); // d is offline

  it('counts online-or-ready participants as the total', () => {
    expect(readyCounter(participants, new Set(['a']), (id) => online.has(id))).toEqual({
      ready: 1,
      total: 3,
    });
  });

  it('an offline player who already answered still counts', () => {
    expect(readyCounter(participants, new Set(['d']), (id) => online.has(id))).toEqual({
      ready: 1,
      total: 4,
    });
  });

  it('is full when everyone online has answered — the offline one is not waited for', () => {
    const counter = readyCounter(participants, new Set(['a', 'b', 'c']), (id) => online.has(id));
    expect(counter).toEqual({ ready: 3, total: 3 });
    expect(canEndEarly(10_000, ROUND.answerStartsAt, counter)).toBe(true);
  });
});

describe('canEndEarly (G-39)', () => {
  it('never during the intro, even if the counter looks full', () => {
    expect(canEndEarly(9_999, ROUND.answerStartsAt, { ready: 3, total: 3 })).toBe(false);
  });

  it('never with total 0 (every phone locked) — the round runs to the timer', () => {
    expect(canEndEarly(20_000, ROUND.answerStartsAt, { ready: 0, total: 0 })).toBe(false);
  });

  it('not while someone online is still answering', () => {
    expect(canEndEarly(20_000, ROUND.answerStartsAt, { ready: 2, total: 3 })).toBe(false);
  });
});
