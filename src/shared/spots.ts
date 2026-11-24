// Game modes as a spot count (GAME_DESCRIPTION G-24). Every round has `spots`: a voter fills the top
// `spots` places from the shown players; the rest stay unplaced. The mode only decides WHO is shown
// (game/rounds/candidates.ts) and how many spots there are (here); answer checks, scoring, the
// reveal, the labels and the ranking screen all just follow the spot count — no per-mode branches.
import { PODIUM_SPOTS } from './constants';

export const GAME_MODES = ['spotlight', 'podium'] as const;
export type GameMode = (typeof GAME_MODES)[number];

/** Spotlight: rank everyone shown. Podium: fill the top PODIUM_SPOTS (fewer if fewer are shown). */
export function spotsFor(mode: GameMode, candidateCount: number): number {
  switch (mode) {
    case 'spotlight':
      return candidateCount;
    case 'podium':
      return Math.min(PODIUM_SPOTS, candidateCount);
    default: {
      const unknown: never = mode;
      throw new Error(`Unknown game mode ${String(unknown)}`);
    }
  }
}

/**
 * Some shown players stay unplaced (Podium with more than PODIUM_SPOTS shown). Then the last place
 * is the "No votes" tie: it is never a reveal step and never called "Least likely" (G-50).
 */
export function isPartialRanking(spots: number, candidateCount: number): boolean {
  return spots < candidateCount;
}
