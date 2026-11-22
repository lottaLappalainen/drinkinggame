import { describe, expect, it } from 'vitest';
import { ADVANCE_EARLY_MS, REVEAL_DRUMROLL_MS, REVEAL_STEP_MS } from '../../src/shared/constants';
import {
  canAdvance,
  revealEndsAt,
  revealPosition,
  revealStepStartsAt,
} from '../../src/shared/reveal';

const START = 1_000_000;

describe('revealEndsAt (G-45, G-50)', () => {
  it('ends immediately when there is nothing to reveal (S-5, S-7)', () => {
    expect(revealEndsAt(START, 0)).toBe(START);
  });

  it('includes every step plus the drumroll', () => {
    expect(revealEndsAt(START, 4)).toBe(START + 4 * REVEAL_STEP_MS + REVEAL_DRUMROLL_MS);
  });
});

describe('revealStepStartsAt', () => {
  it('delays only the last step by the drumroll', () => {
    expect(revealStepStartsAt(START, 4, 0)).toBe(START);
    expect(revealStepStartsAt(START, 4, 2)).toBe(START + 2 * REVEAL_STEP_MS);
    expect(revealStepStartsAt(START, 4, 3)).toBe(START + 3 * REVEAL_STEP_MS + REVEAL_DRUMROLL_MS);
  });
});

describe('revealPosition — phones jump to the current step', () => {
  const n = 4;

  it('is pending before the start', () => {
    expect(revealPosition(START - 1, START, n)).toEqual({ kind: 'pending' });
  });

  it('walks through the steps', () => {
    expect(revealPosition(START, START, n)).toEqual({ kind: 'step', index: 0 });
    expect(revealPosition(START + REVEAL_STEP_MS + 10, START, n)).toEqual({
      kind: 'step',
      index: 1,
    });
    expect(revealPosition(START + 2 * REVEAL_STEP_MS + 10, START, n)).toEqual({
      kind: 'step',
      index: 2,
    });
  });

  it('has a drumroll before the last step', () => {
    const drumroll = START + 3 * REVEAL_STEP_MS + 10;
    expect(revealPosition(drumroll, START, n)).toEqual({ kind: 'drumroll', afterStep: 2 });
    expect(revealPosition(revealStepStartsAt(START, n, 3), START, n)).toEqual({
      kind: 'step',
      index: 3,
    });
  });

  it('is done at revealEndsAt and later', () => {
    expect(revealPosition(revealEndsAt(START, n), START, n)).toEqual({ kind: 'done' });
    expect(revealPosition(revealEndsAt(START, n) + 60_000, START, n)).toEqual({ kind: 'done' });
  });

  it('a phone that reconnects mid-reveal lands on the right step (no replay)', () => {
    const now = revealStepStartsAt(START, n, 2) + 100;
    expect(revealPosition(now, START, n)).toEqual({ kind: 'step', index: 2 });
  });

  it('with a single step: drumroll first, then the step', () => {
    expect(revealPosition(START, START, 1)).toEqual({ kind: 'drumroll', afterStep: -1 });
    expect(revealPosition(START + REVEAL_DRUMROLL_MS, START, 1)).toEqual({
      kind: 'step',
      index: 0,
    });
  });

  it('with no steps: pending, then done', () => {
    expect(revealPosition(START - 1, START, 0)).toEqual({ kind: 'pending' });
    expect(revealPosition(START, START, 0)).toEqual({ kind: 'done' });
  });

  it('always moves forward (monotonic) as time passes', () => {
    const order = (p: ReturnType<typeof revealPosition>): number =>
      p.kind === 'pending'
        ? -2
        : p.kind === 'drumroll'
          ? p.afterStep + 0.5
          : p.kind === 'step'
            ? p.index
            : 99;
    let previous = -Infinity;
    for (let t = START - 1_000; t <= revealEndsAt(START, n) + 1_000; t += 50) {
      const current = order(revealPosition(t, START, n));
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe('canAdvance — clock drift tolerance (G-45)', () => {
  const ends = revealEndsAt(START, 4);

  it(`accepts Next up to ${ADVANCE_EARLY_MS} ms early`, () => {
    expect(canAdvance(ends - ADVANCE_EARLY_MS, ends)).toBe(true);
    expect(canAdvance(ends, ends)).toBe(true);
  });

  it('rejects Next mid-reveal', () => {
    expect(canAdvance(ends - ADVANCE_EARLY_MS - 1, ends)).toBe(false);
  });
});
