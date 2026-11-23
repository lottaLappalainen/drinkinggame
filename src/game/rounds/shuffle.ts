// Fisher–Yates shuffle with the injected random source (never Math.random — CLAUDE.md §7), so
// games are deterministic in tests.

/** Shuffles `items` in place and returns them. `random` is in [0, 1); a 1 is clamped, not trusted. */
export function shuffle<T>(items: T[], random: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.min(Math.floor(random() * (i + 1)), i);
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue; // unreachable: i and j are in range
    items[i] = b;
    items[j] = a;
  }
  return items;
}
