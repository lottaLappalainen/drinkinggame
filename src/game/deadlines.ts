// The ONE function that knows where every game deadline lives (CLAUDE.md §4 "Alarms").
// The DO sets its alarm to min(nextDeadline(state), next liveness check) after every event and
// never needs to know how deadlines are stored. The liveness check is server-only, not here.
import { IDLE_LOBBY_MS, IDLE_STARTED_MS } from '../shared/constants';
import type { GameState } from './stateSchema';

/** When nobody-connected cleanup is due, or null (CLAUDE.md §6 "Cleanup"). */
export function idleCleanupAt(state: GameState): number | null {
  if (state.idleSince === null || state.phase === 'ENDED') return null;
  return state.idleSince + (state.phase === 'LOBBY' ? IDLE_LOBBY_MS : IDLE_STARTED_MS);
}

/** Earliest game deadline, or null if none is pending. */
export function nextDeadline(state: GameState): number | null {
  const candidates: number[] = [];
  const { roundEnd, hostHandover, retention } = state.deadlines;
  if (roundEnd !== undefined) candidates.push(roundEnd);
  if (hostHandover !== undefined) candidates.push(hostHandover);
  if (retention !== undefined) candidates.push(retention);
  for (const request of Object.values(state.reclaims)) candidates.push(request.expiresAt);
  const idle = idleCleanupAt(state);
  if (idle !== null) candidates.push(idle);
  return candidates.length === 0 ? null : Math.min(...candidates);
}
