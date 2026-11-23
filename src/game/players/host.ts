// Host handover (GAME_DESCRIPTION §10, G-41): who becomes host when the host leaves, stays
// offline too long, or the role is vacant.
import { HOST_HANDOVER_MS } from '../../shared/constants';
import type { PlayerId } from '../../shared/protocol';
import { broadcast, toHost } from '../effects';
import type { GameState } from '../stateSchema';
import type { Effect } from '../types';
import { activePlayers, isOnline } from './presence';
import { pendingReclaimMessages } from './reclaims';

/**
 * The online active player connected the longest (earliest connectedSince; ties and restarts →
 * earliest joinedAt; then id, so the choice is deterministic). null if nobody is online.
 */
export function pickNewHost(state: GameState, except?: PlayerId): PlayerId | null {
  const candidates = activePlayers(state)
    .filter(([id, player]) => id !== except && isOnline(player))
    .sort(
      ([idA, a], [idB, b]) =>
        (a.connectedSince ?? Infinity) - (b.connectedSince ?? Infinity) ||
        a.joinedAt - b.joinedAt ||
        // Plain code-unit comparison: localeCompare depends on the runtime's locale.
        (idA < idB ? -1 : idA > idB ? 1 : 0),
    );
  return candidates[0]?.[0] ?? null;
}

/**
 * Hand the host role to `newHost` (null = vacant). The new host gets the pending "That's me"
 * requests unless `theyGetASnapshot` (a welcome already contains them for the host).
 */
export function changeHost(
  state: GameState,
  newHost: PlayerId | null,
  theyGetASnapshot = false,
): Effect[] {
  delete state.deadlines.hostHandover;
  if (state.hostId === newHost) return [];
  state.hostId = newHost;
  const effects: Effect[] = [broadcast({ type: 'hostChanged', hostId: newHost })];
  if (newHost !== null && !theyGetASnapshot) {
    effects.push(...pendingReclaimMessages(state).map((message) => toHost(message)));
  }
  return effects;
}

/** A vacant host role goes to the next active player who connects (CLAUDE.md §6). */
export function fillVacantHost(state: GameState, playerId: PlayerId): Effect[] {
  if (state.hostId !== null || state.players[playerId]?.status !== 'active') return [];
  return changeHost(state, playerId, true);
}

/** The host went offline: give them HOST_HANDOVER_MS to come back (only set once). */
export function startHandoverTimer(state: GameState, now: number): void {
  if (state.hostId === null || state.phase === 'ENDED') return;
  const host = state.players[state.hostId];
  if (host && !isOnline(host)) state.deadlines.hostHandover ??= now + HOST_HANDOVER_MS;
}

/** The host came back in time. */
export function cancelHandoverIfHostOnline(state: GameState): void {
  const host = state.hostId === null ? undefined : state.players[state.hostId];
  if (host && isOnline(host)) delete state.deadlines.hostHandover;
}

/** Handover deadline reached: pass the role on if the host is still offline. */
export function runHandover(state: GameState): Effect[] {
  delete state.deadlines.hostHandover;
  const host = state.hostId === null ? undefined : state.players[state.hostId];
  if (host && isOnline(host)) return [];
  return changeHost(state, pickNewHost(state));
}
