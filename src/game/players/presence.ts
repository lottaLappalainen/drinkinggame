// Who is online — the single place that flips a player between online and offline, so the
// timestamps, idle tracking and the broadcast always change together (CLAUDE.md §4).
import type { ConnId, PlayerId } from '../../shared/protocol';
import { broadcast } from '../effects';
import { entriesOf } from '../ids';
import type { GameState, PlayerState } from '../stateSchema';
import type { Effect } from '../types';
import { denyReclaimsFor } from './reclaims';

export function isOnline(player: PlayerState): boolean {
  return player.connId !== null;
}

/** Active players (not left / removed), including late joiners waiting for their first round. */
export function activePlayers(state: GameState): [PlayerId, PlayerState][] {
  return entriesOf(state.players).filter(([, player]) => player.status === 'active');
}

/**
 * Make `connId` the player's current socket. If the player was offline, returns the announcement
 * for the others — and auto-denies a pending "That's me" for them: the real player is back, so the
 * host's prompt and the requester's wait end now (G-44). A replaced socket keeps them online, so
 * nothing happens then.
 */
export function setOnline(
  state: GameState,
  playerId: PlayerId,
  connId: ConnId,
  now: number,
): Effect[] {
  const player = state.players[playerId];
  if (player === undefined) return [];
  const wasOffline = player.connId === null;
  player.connId = connId;
  if (wasOffline) {
    player.connectedSince = now;
    player.offlineSince = null;
  }
  const connection = state.connections[connId];
  if (connection) {
    connection.playerId = playerId;
    delete connection.reclaimRequestId;
  }
  refreshIdle(state, now);
  if (!wasOffline) return [];
  return [
    broadcast({ type: 'playerConnection', playerId, online: true, offlineSince: null }, [playerId]),
    ...denyReclaimsFor(state, playerId),
  ];
}

/** The player has no current socket any more. Returns the announcement for the others. */
export function setOffline(state: GameState, playerId: PlayerId, now: number): Effect[] {
  const player = state.players[playerId];
  if (player?.connId == null) return [];
  player.connId = null;
  player.connectedSince = null;
  player.offlineSince = now;
  refreshIdle(state, now);
  return player.status === 'active'
    ? [broadcast({ type: 'playerConnection', playerId, online: false, offlineSince: now })]
    : [];
}

/**
 * idleSince = when the last active player went offline; null while any active player is online.
 * Anonymous sockets don't count (CLAUDE.md §6 "Cleanup").
 */
export function refreshIdle(state: GameState, now: number): void {
  const anyOnline = activePlayers(state).some(([, player]) => isOnline(player));
  if (anyOnline) state.idleSince = null;
  else state.idleSince ??= now;
}
