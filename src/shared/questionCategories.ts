// Question categories (GAME_DESCRIPTION Q-7, G-22). Every question in the bank belongs to exactly
// one. `default` is ALWAYS in a game's pool; `spicy` and `luuppi` are add-ons the host may switch
// on (neither, either or both) — turning one on only adds its questions to the pool, no quotas.
// Shared because phones show the toggles and the question tag.
//
// Once a game engine has been deployed: NEVER rename or remove an id that a question or a saved game
// may use — a saved game would fail its schema check on load. Add new categories at the end.
// (`mild` / `personal` were replaced on 2026-11-24, before any engine deploy.)

export const CATEGORY_IDS = ['default', 'spicy', 'luuppi'] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** Always played; not a setting, and the lobby needn't show it (G-22). */
export const ALWAYS_ON_CATEGORY = 'default' satisfies CategoryId;

/** The categories the host can add (G-22) — every id except the always-on one. */
export const ADD_ON_CATEGORY_IDS = ['spicy', 'luuppi'] as const satisfies readonly CategoryId[];
export type AddOnCategoryId = (typeof ADD_ON_CATEGORY_IDS)[number];

export type Category = {
  readonly id: CategoryId;
  /** Shown on the lobby toggles and the question tag. */
  readonly name: string;
  readonly emoji: string;
};

/** In display order. */
export const CATEGORIES: readonly Category[] = [
  { id: 'default', name: 'Default', emoji: '💬' },
  { id: 'spicy', name: 'Spicy', emoji: '🌶️' },
  { id: 'luuppi', name: 'Luuppi', emoji: '🔍' },
];

/** Add-ons switched on in a new lobby (G-22 — default unsure: both off). */
export const DEFAULT_CATEGORIES: readonly AddOnCategoryId[] = [];

export function categoryById(id: CategoryId): Category {
  const found = CATEGORIES.find((category) => category.id === id);
  // Safe: CATEGORIES lists every CategoryId (checked by test/shared/questionMeta.test.ts).
  if (found === undefined) throw new Error(`Unknown category ${id}`);
  return found;
}

/** Canonical form of an add-on selection: known ids, no duplicates, in display order. */
export function normalizeCategories(ids: readonly AddOnCategoryId[]): AddOnCategoryId[] {
  return ADD_ON_CATEGORY_IDS.filter((id) => ids.includes(id));
}

/** Every category a game draws from: the always-on one plus the chosen add-ons (G-22). */
export function gameCategories(addOns: readonly AddOnCategoryId[]): CategoryId[] {
  return [ALWAYS_ON_CATEGORY, ...normalizeCategories(addOns)];
}
