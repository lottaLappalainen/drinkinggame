// Random ids for players, game instances and reclaim requests. Uses the injected random source
// (ctx.random) — never Math.random — so tests are deterministic (CLAUDE.md §7 TypeScript).
import { ID_LENGTH } from '../shared/protocol';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Returns a 12-character base62 id. `random` must return values in [0, 1). */
export function randomId(random: () => number): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ALPHABET.charAt(Math.floor(random() * ALPHABET.length));
  }
  return id;
}
