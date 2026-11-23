// Saving and loading the game state (CLAUDE.md §4 "State version + schema"). One KV entry, written
// with the SYNCHRONOUS API so an event never awaits between reading and writing its state.
import * as v from 'valibot';
import { GameIdSchema, GameKeySchema } from '../../shared/protocol';
import { GameStateSchema, createUpdatedEndState, type GameState } from '../../game/stateSchema';

export const STATE_KEY = 'state';

export type Loaded =
  /** No game under this key (never claimed, or deleted). */
  | { readonly kind: 'none' }
  | { readonly kind: 'game'; readonly state: GameState }
  /**
   * The saved state was written by other code (version bump or a shape the schema rejects): the
   * game is replaced by an ENDED 'updated' state, so phones hear "The game was updated" instead of
   * a crash or a silently broken game.
   */
  | { readonly kind: 'updated'; readonly state: GameState };

export function loadState(kv: SyncKvStorage, now: number): Loaded {
  const raw: unknown = kv.get(STATE_KEY);
  if (raw === undefined) return { kind: 'none' };

  // The schema requires stateVersion === STATE_VERSION (a literal), so one check covers both a
  // version bump and a shape the current code can't read (a forgotten bump).
  const parsed = v.safeParse(GameStateSchema, raw);
  if (parsed.success) return { kind: 'game', state: parsed.output };

  // Keep only what identifies the game; everything else is unreadable by this code.
  const fields = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const key = v.safeParse(GameKeySchema, fields.key);
  const gameId = v.safeParse(GameIdSchema, fields.gameId);
  if (!key.success || !gameId.success) return { kind: 'none' }; // nothing usable: treat as empty
  return {
    kind: 'updated',
    state: createUpdatedEndState({ key: key.output, gameId: gameId.output, now }),
  };
}

export function saveState(kv: SyncKvStorage, state: GameState): void {
  kv.put(STATE_KEY, state);
}
