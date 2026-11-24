// Drinking rules (GAME_DESCRIPTION §5.3, D-1…D-9). The ONE table of who drinks how much — tune
// the numbers here. Keyed by the reveal step's KIND (its position), never by the game mode: a
// Podium round with unplaced players has no `bottom` step, so "top three only" (D-5) follows from
// the reveal rules (G-50) without a mode check.
//
// The server draws the number (game/scoring/drinks.ts) once per step; phones only display it and
// use the range for the number-roll animation.
import type { RevealStepKind } from './protocol';

export const DRINK_ACTIONS = ['drink', 'give'] as const;
export type DrinkAction = (typeof DRINK_ACTIONS)[number];

export type DrinkRange = {
  readonly action: DrinkAction;
  /** Inclusive, whole sips. */
  readonly min: number;
  readonly max: number;
};

export const DRINK_RULES: { readonly [K in RevealStepKind]: DrinkRange } = {
  bottom: { action: 'drink', min: 2, max: 8 }, // last place
  third: { action: 'drink', min: 1, max: 3 },
  second: { action: 'drink', min: 2, max: 4 },
  top: { action: 'give', min: 1, max: 10 }, // most likely gives out
};

/** Largest number any rule can draw — the wire schema's upper bound. */
export const MAX_SIPS = Math.max(...Object.values(DRINK_RULES).map((range) => range.max));

/**
 * A uniform whole number in [min, max] from `random` (uniform in [0, 1)). Pure — the caller passes
 * the game's random source, so tests are deterministic.
 */
export function drawSips(range: DrinkRange, random: () => number): number {
  const span = range.max - range.min + 1;
  return range.min + Math.min(span - 1, Math.floor(random() * span));
}

/** Whether `sips` is a number this rule could have drawn (invariants, tests). */
export function inRange(range: DrinkRange, sips: number): boolean {
  return Number.isInteger(sips) && sips >= range.min && sips <= range.max;
}
