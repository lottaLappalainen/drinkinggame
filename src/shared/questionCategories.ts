// Question categories (GAME_DESCRIPTION Q-7, G-22). Every question in the bank belongs to exactly
// one; the host picks which ones a game uses. Shared because phones show the chips and tags.
//
// Like avatar presets: NEVER rename or remove an id that a question or a saved game may use — a
// saved game would fail its schema check on load. Add new categories at the end.

export const CATEGORY_IDS = ['mild', 'spicy', 'personal'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export type Category = {
  readonly id: CategoryId;
  /** Shown on the lobby chips and the question tag. */
  readonly name: string;
  readonly emoji: string;
};

/** In display order. */
export const CATEGORIES: readonly Category[] = [
  { id: 'mild', name: 'Mild', emoji: '🙂' },
  { id: 'spicy', name: 'Spicy', emoji: '🌶️' },
  { id: 'personal', name: 'Personal', emoji: '🤫' },
];

/** On in a new lobby (G-22 — default unsure, U7). */
export const DEFAULT_CATEGORIES: readonly CategoryId[] = ['mild', 'spicy'];

export function categoryById(id: CategoryId): Category {
  const found = CATEGORIES.find((category) => category.id === id);
  // Safe: CATEGORIES lists every CategoryId (checked by test/shared/questionMeta.test.ts).
  if (found === undefined) throw new Error(`Unknown category ${id}`);
  return found;
}

/** Canonical form of a category selection: known ids, no duplicates, in display order. */
export function normalizeCategories(ids: readonly CategoryId[]): CategoryId[] {
  return CATEGORY_IDS.filter((id) => ids.includes(id));
}
