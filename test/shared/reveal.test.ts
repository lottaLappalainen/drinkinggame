import { describe, expect, it } from 'vitest';
import { ADVANCE_EARLY_MS, REVEAL_DRUMROLL_MS, REVEAL_STEP_MS } from '../../src/shared/constants';
import {
  serverAcceptsAdvance,
  revealEndsAt,
  revealPosition,
  nextRevealChangeAt,
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

describe('serverAcceptsAdvance — server-only clock drift tolerance (G-45)', () => {
  const ends = revealEndsAt(START, 4);

  it(`accepts Next up to ${ADVANCE_EARLY_MS} ms early`, () => {
    expect(serverAcceptsAdvance(ends - ADVANCE_EARLY_MS, ends)).toBe(true);
    expect(serverAcceptsAdvance(ends, ends)).toBe(true);
  });

  it('rejects Next mid-reveal', () => {
    expect(serverAcceptsAdvance(ends - ADVANCE_EARLY_MS - 1, ends)).toBe(false);
  });
});

describe('nextRevealChangeAt — one timer instead of per-frame polling', () => {
  for (const steps of [0, 1, 2, 3, 4]) {
    it(`points exactly at the next change of revealPosition (${steps} steps)`, () => {
      const end = revealEndsAt(START, steps);
      for (let now = START - 1_000; now <= end + 1_000; now += 50) {
        const next = nextRevealChangeAt(now, START, steps);
        const here = JSON.stringify(revealPosition(now, START, steps));
        if (next === null) {
          // Nothing changes any more: the reveal is done.
          expect(revealPosition(now, START, steps).kind).toBe('done');
          continue;
        }
        expect(next).toBeGreaterThan(now);
        // No change before `next` …
        expect(JSON.stringify(revealPosition(next - 1, START, steps))).toBe(here);
        // … and a change exactly at `next`.
        expect(JSON.stringify(revealPosition(next, START, steps))).not.toBe(here);
      }
    });
  }
});
