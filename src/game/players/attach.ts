// Turning a socket into a player's current socket — shared by hello (resume), an approved "That's
// me" and a rebuild that finds an approved requester still connected.
import { WS_CLOSE } from '../../shared/constants';
import type { ConnId, PlayerId } from '../../shared/protocol';
import { bindToPlayer, close, send } from '../effects';
import type { GameState } from '../stateSchema';
import type { Effect } from '../types';
import { cancelHandoverIfHostOnline, fillVacantHost } from './host';
import { setOnline } from './presence';
import { buildSnapshot } from './view';

/**
 * Make `connId` the player's current socket and send them a welcome. A previous socket of the same
 * player is told REPLACED and closed (G-18) — its later close won't mark them offline.
 */
export function attachAsPlayer(
  draft: GameState,
  playerId: PlayerId,
  connId: ConnId,
  now: number,
): Effect[] {
  const replaced: Effect[] = [];
  const previous = draft.players[playerId]?.connId ?? null;
  if (previous !== null && previous !== connId) {
    replaced.push(
      send(previous, { type: 'error', code: 'REPLACED' }),
      close(previous, WS_CLOSE.REPLACED, 'replaced'),
    );
  }
  // All state changes first; then the welcome (built from the result) goes out BEFORE any delta
  // this socket would also receive — "welcome first" (CLAUDE.md §5, checked in test/game/helpers).
  // Coming back online also auto-denies a pending "That's me" for this player (G-44, in setOnline).
  const deltas = setOnline(draft, playerId, connId, now);
  cancelHandoverIfHostOnline(draft);
  deltas.push(...fillVacantHost(draft, playerId));
  return [
    ...replaced,
    bindToPlayer(connId, playerId),
    welcome(draft, playerId, connId, now),
    ...deltas,
  ];
}

export function welcome(draft: GameState, playerId: PlayerId, connId: ConnId, now: number): Effect {
  return send(connId, {
    type: 'welcome',
    playerId,
    gameId: draft.gameId,
    snapshot: buildSnapshot(draft, playerId),
    serverTime: now,
  });
}
