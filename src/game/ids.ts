// Random ids for players, game instances and reclaim requests. Uses the injected random source
// (ctx.random) — never Math.random — so tests are deterministic (CLAUDE.md §7 TypeScript).
import { ID_LENGTH, type GameId, type PlayerId, type RequestId } from '../shared/protocol';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Returns a 12-character base62 id. `random` should return values in [0, 1); a source that
 * returns exactly 1 is clamped to the last character instead of producing a shorter id.
 */
export function randomId(random: () => number): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    const index = Math.min(Math.floor(random() * ALPHABET.length), ALPHABET.length - 1);
    id += ALPHABET.charAt(index);
  }
  return id;
}

// Branded constructors. The casts are safe: randomId always matches the 12-char base62 format
// that PlayerIdSchema / GameIdSchema / RequestIdSchema check.
export const newPlayerId = (random: () => number): PlayerId => randomId(random) as PlayerId;
export const newGameId = (random: () => number): GameId => randomId(random) as GameId;
export const newRequestId = (random: () => number): RequestId => randomId(random) as RequestId;

/** Object.keys with the record's (branded) key type — plain Object.keys widens to string. */
export function keysOf<K extends string, V>(record: Readonly<Record<K, V>>): K[] {
  return Object.keys(record) as K[];
}

/** Object.entries with the record's (branded) key type. */
export function entriesOf<K extends string, V>(record: Readonly<Record<K, V>>): [K, V][] {
  return Object.entries(record) as [K, V][];
}
