// Server-side randomness (the engine itself only ever uses the `random` it is given).
import { GAME_KEY_ALPHABET, GAME_KEY_LENGTH } from '../../shared/constants';
import { ConnIdSchema, GameKeySchema, type ConnId, type GameKey } from '../../shared/protocol';
import * as v from 'valibot';

/** Uniform in [0, 1), from the platform's cryptographic generator. */
export function random(): number {
  const [n = 0] = crypto.getRandomValues(new Uint32Array(1));
  return n / 2 ** 32;
}

/** A socket id — unique per object, only ever used as a tag and a key in state.connections. */
export function newConnId(): ConnId {
  return v.parse(ConnIdSchema, crypto.randomUUID());
}

/** A random game key from the read-aloud alphabet (G-11), without modulo bias. */
export function newGameKey(): GameKey {
  const size = GAME_KEY_ALPHABET.length;
  const limit = 256 - (256 % size); // bytes at or above this would favour the first letters
  let key = '';
  while (key.length < GAME_KEY_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
      if (byte < limit && key.length < GAME_KEY_LENGTH)
        key += GAME_KEY_ALPHABET.charAt(byte % size);
    }
  }
  return v.parse(GameKeySchema, key);
}
