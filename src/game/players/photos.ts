// Who may store a profile photo, and when (G-5, G-6) — checked by the server BEFORE it stores the
// bytes; the `photoStored` event then bumps the version and tells everyone.
import type { PlayerId } from '../../shared/protocol';
import type { GameState, PlayerState } from '../stateSchema';

/**
 * The version the next stored photo gets — ONE definition for the server (which saves the bytes
 * under it) and the `photoStored` event (which publishes it), so `?v=N` always names the bytes that
 * were saved as version N.
 */
export function nextPhotoVersion(player: PlayerState): number {
  return (player.avatar.photoVersion ?? 0) + 1;
}

export type PhotoUploadVerdict =
  | 'ok'
  /** No such player in this game. */
  | 'unknownPlayer'
  /** The token isn't this player's (only the player changes their own picture, G-6). */
  | 'wrongToken'
  /** The player left or was removed. */
  | 'notActive'
  /** Changing a photo is lobby-only (G-5); a FIRST photo (late joiner, failed upload) is fine. */
  | 'locked';

export function photoUploadVerdict(
  state: GameState,
  playerId: PlayerId,
  tokenHash: string,
): PhotoUploadVerdict {
  const player = state.players[playerId];
  if (player === undefined) return 'unknownPlayer';
  if (player.tokenHash !== tokenHash) return 'wrongToken';
  if (player.status !== 'active') return 'notActive';
  if (state.phase === 'ENDED') return 'locked';
  if (state.phase !== 'LOBBY' && player.avatar.photoVersion !== null) return 'locked';
  return 'ok';
}
