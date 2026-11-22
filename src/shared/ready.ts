// The ready counter (G-38, G-39) — ONE definition, used by the server ("everyone is ready" →
// end the round early) and the phones ("6 / 8 ready"), so the counter is full exactly when the
// round ends early.
//
// total = players taking part in this round who are online OR already ready
// ready = those of them who submitted
// Offline players who haven't answered are listed separately and are NOT in total.

import type { PlayerId } from './protocol';

export type ReadyCounter = { readonly ready: number; readonly total: number };

export function readyCounter(
  participants: readonly PlayerId[],
  readyIds: ReadonlySet<PlayerId>,
  isOnline: (playerId: PlayerId) => boolean,
): ReadyCounter {
  let ready = 0;
  let total = 0;
  for (const id of participants) {
    const isReady = readyIds.has(id);
    if (isReady) ready++;
    if (isReady || isOnline(id)) total++;
  }
  return { ready, total };
}

/**
 * A round may end early only once answering has started AND someone is being waited for —
 * otherwise every phone locking during the intro would read "0 / 0 = full" (G-39).
 */
export function canEndEarly(now: number, answerStartsAt: number, counter: ReadyCounter): boolean {
  return now >= answerStartsAt && counter.total >= 1 && counter.ready === counter.total;
}
