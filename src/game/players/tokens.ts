// Who a phone's token belongs to (CLAUDE.md §3 "Phone-generated tokens"): a player now, a player
// before an approved "That's me" moved them to another phone (G-44), or a pending request.
import type { PlayerId, RequestId } from '../../shared/protocol';
import { entriesOf } from '../ids';
import type { GameState, PlayerState, ReclaimState } from '../stateSchema';

export function findPlayerByToken(
  state: GameState,
  tokenHash: string,
): [PlayerId, PlayerState] | undefined {
  return entriesOf(state.players).find(([, player]) => player.tokenHash === tokenHash);
}

/** A player this token USED to belong to, before an approved "That's me" (G-44). */
export function findPlayerByPreviousToken(
  state: GameState,
  tokenHash: string,
): [PlayerId, PlayerState] | undefined {
  return entriesOf(state.players).find(([, player]) =>
    player.previousTokenHashes.includes(tokenHash),
  );
}

export function findReclaimByToken(
  state: GameState,
  tokenHash: string,
): [RequestId, ReclaimState] | undefined {
  return entriesOf(state.reclaims).find(([, r]) => r.requesterTokenHash === tokenHash);
}
