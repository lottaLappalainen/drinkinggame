// Label sets (GAME_DESCRIPTION Q-8): the words on the ranking spots and the reveal steps follow
// the question's wording. A question names a set ("likely" by default); the words live only here,
// so polishing a label fixes it for every question — and since only the set id travels on the
// wire, a wording change is client-only (no protocol bump).
//
// NEVER rename or remove a set id that a question or a saved game may use. Add new sets freely.

export const LABEL_SET_IDS = ['likely', 'most'] as const;
export type LabelSetId = (typeof LABEL_SET_IDS)[number];

export const DEFAULT_LABEL_SET: LabelSetId = 'likely';

export type LabelSet = {
  /** Place 1 (G-36 top spot, the final reveal step). */
  readonly top: string;
  readonly second: string;
  readonly third: string;
  /** The last place (bottom spot, the first reveal step). */
  readonly bottom: string;
};

export const LABEL_SETS: { readonly [K in LabelSetId]: LabelSet } = {
  // "Who is most likely to …?"
  likely: {
    top: 'Most likely',
    second: '2nd most likely',
    third: '3rd most likely',
    bottom: 'Least likely',
  },
  // "Who would you want to kiss the most?"
  most: { top: 'Most', second: '2nd most', third: '3rd most', bottom: 'Least' },
};

/**
 * The words for one place — the ONLY function that turns a place into text (ranking-spot captions,
 * every reveal step, the full ranking). `lastPlace` = the place number of the bottom group; it wins
 * over 2nd/3rd (with 3 players, the last place is "Least likely", not "3rd most likely" — G-50).
 * Places between 3rd and the last are plain ordinals.
 */
export function placeLabel(set: LabelSetId, place: number, lastPlace: number): string {
  const labels = LABEL_SETS[set];
  if (place === 1) return labels.top;
  if (place === lastPlace) return labels.bottom;
  if (place === 2) return labels.second;
  if (place === 3) return labels.third;
  return ordinal(place);
}

/** 4 → "4th", 11 → "11th", 22 → "22nd". */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Q-9: does the text obviously disagree with its label set? Catches the easy mistake of copying a
 * question and forgetting (or leaving) the `labels` field. Deliberately simple — a heuristic for
 * the bank test, not a language model.
 */
export function labelMismatch(text: string, set: LabelSetId): string | null {
  const lower = text.toLowerCase();
  if (set === 'likely' && !lower.includes('likely'))
    return `uses the "likely" labels but the text doesn't say "likely" — add a "labels" field`;
  if (set !== 'likely' && lower.includes('most likely'))
    return `says "most likely" but uses the "${set}" labels`;
  return null;
}
