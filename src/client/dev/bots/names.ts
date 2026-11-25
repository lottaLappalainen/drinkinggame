// The test bots' names, in the order they are used (the user's list). 25 names: enough for the
// most bots a game can hold (MAX_PLAYERS − you). A name already in the game is skipped.
export const BOT_NAMES = [
  'anni1',
  'anni4',
  'iidalotta',
  'eme',
  'ede',
  'emmi',
  'sonja',
  'mahari',
  'marleena',
  'jasmin',
  'lauri',
  'sakke',
  'kasperi',
  'tommi',
  'xixi',
  'enni',
  'elina',
  'neea',
  'heta',
  'vilma',
  'oona',
  'roosa',
  'tuulianna',
  'lina',
  'tomi',
] as const;

/** The first bot name nobody uses yet (compared like "Name taken": case-insensitive), or null. */
export function freeBotName(taken: ReadonlySet<string>): string | null {
  return BOT_NAMES.find((name) => !taken.has(name.toLowerCase())) ?? null;
}
