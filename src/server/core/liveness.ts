// Liveness check (CLAUDE.md §6): a phone whose battery dies can leave a half-open socket that looks
// online forever — blocking host handover and the ready counter. Server-side only: nothing is
// written to the game state; closing a stale socket becomes a normal `connectionClosed` event.
//
// It uses the REAL wall clock on purpose: it's about real network silence, not game time.
import { LIVENESS_CHECK_MS, LIVENESS_TIMEOUT_MS } from '../../shared/constants';

/**
 * The next check time on a fixed grid (every LIVENESS_CHECK_MS since the epoch). A grid instead of
 * "now + interval": every event re-sets the alarm, and with "now + interval" a busy or often-woken
 * game would push the check forward forever. Every wake computes the same grid point.
 */
export function nextLivenessCheckAt(now: number): number {
  return (Math.floor(now / LIVENESS_CHECK_MS) + 1) * LIVENESS_CHECK_MS;
}

/**
 * Silent for too long? Last sign of life = the last ping the runtime answered for this socket, or —
 * for a socket that hasn't pinged yet — when it was accepted (so a brand-new socket isn't closed).
 */
export function isStale(lastPingAt: number | null, openedAt: number, now: number): boolean {
  return now - Math.max(lastPingAt ?? 0, openedAt) > LIVENESS_TIMEOUT_MS;
}
