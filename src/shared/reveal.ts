// Reveal timing (G-45, G-50). The ONE implementation used by both the server (when Next is
// accepted) and the phones (which step to show, when Next unlocks) — so they can never disagree.
//
// Timeline for n steps, starting at revealStartsAt:
//   step i (i < n-1) is shown from  start + i·STEP
//   the last step ("most likely")   start + (n-1)·STEP + DRUMROLL   (drumroll pause before it)
//   done (full ranking)             start + n·STEP + DRUMROLL       = revealEndsAt
// With n = 0 ("nobody answered" / "not enough answers") the reveal ends immediately.
import { ADVANCE_EARLY_MS, REVEAL_DRUMROLL_MS, REVEAL_STEP_MS } from './constants';

export function revealEndsAt(revealStartsAt: number, stepCount: number): number {
  if (stepCount <= 0) return revealStartsAt;
  return revealStartsAt + stepCount * REVEAL_STEP_MS + REVEAL_DRUMROLL_MS;
}

/** When step `index` (0-based) becomes visible. */
export function revealStepStartsAt(
  revealStartsAt: number,
  stepCount: number,
  index: number,
): number {
  const base = revealStartsAt + index * REVEAL_STEP_MS;
  return index === stepCount - 1 ? base + REVEAL_DRUMROLL_MS : base;
}

export type RevealPosition =
  | { readonly kind: 'pending' } // results received, reveal not started yet
  | { readonly kind: 'drumroll'; readonly afterStep: number } // pause before the last step (-1 = before any)
  | { readonly kind: 'step'; readonly index: number }
  | { readonly kind: 'done' }; // full ranking

/**
 * Where the reveal is at `now`. Phones call this every frame and render the matching state —
 * they jump to it instead of playing steps one after another (CLAUDE.md §4 State machine).
 */
export function revealPosition(
  now: number,
  revealStartsAt: number,
  stepCount: number,
): RevealPosition {
  if (stepCount <= 0) return now < revealStartsAt ? { kind: 'pending' } : { kind: 'done' };
  if (now < revealStartsAt) return { kind: 'pending' };
  if (now >= revealEndsAt(revealStartsAt, stepCount)) return { kind: 'done' };

  const last = stepCount - 1;
  if (now >= revealStepStartsAt(revealStartsAt, stepCount, last))
    return { kind: 'step', index: last };
  const index = Math.floor((now - revealStartsAt) / REVEAL_STEP_MS);
  if (index >= last) return { kind: 'drumroll', afterStep: last - 1 };
  return { kind: 'step', index };
}

/** True when the host's Next may be accepted (clock-drift tolerance included, G-45). */
export function canAdvance(now: number, revealEndsAtMs: number): boolean {
  return now >= revealEndsAtMs - ADVANCE_EARLY_MS;
}
