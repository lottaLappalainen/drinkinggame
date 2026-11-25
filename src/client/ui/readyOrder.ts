// The order of the waiting list (G-38): who we're still waiting for comes first — answering
// (online), then offline — and the ready players last (user 2026-11-25). Ties keep the round's
// participant order (Array.prototype.sort is stable).
import type { PlayerId } from '../../shared/protocol';

export function readyListOrder(
  participants: readonly PlayerId[],
  ready: ReadonlySet<PlayerId>,
  isOnline: (id: PlayerId) => boolean,
): PlayerId[] {
  const rank = (id: PlayerId) => (ready.has(id) ? 2 : isOnline(id) ? 0 : 1);
  return [...participants].sort((a, b) => rank(a) - rank(b));
}
