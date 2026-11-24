// Clock sync (CLAUDE.md §6 "Timer sync"): ~5 `timeSync` round trips after each (re)connect; the
// sample with the lowest round-trip time wins, because its "the server answered halfway" guess is
// the most accurate. Then `serverNow()` = the phone's clock + offset — every countdown and reveal
// step is computed from it, with no per-second messages.

export type ClockSample = { readonly rtt: number; readonly offset: number };

/**
 * One sample: sent at `t0` (phone clock), answered with `serverTime`, received at `t1`.
 * offset = serverTime − (t0 + rtt / 2).
 */
export function clockSample(t0: number, serverTime: number, t1: number): ClockSample {
  const rtt = Math.max(0, t1 - t0);
  return { rtt, offset: serverTime - (t0 + rtt / 2) };
}

export type Clock = ReturnType<typeof createClock>;

export function createClock(phoneNow: () => number = Date.now) {
  let best: ClockSample | null = null;
  return {
    /** Keep the sample if it beats the current best (lowest round trip). */
    add(sample: ClockSample): void {
      if (best === null || sample.rtt < best.rtt) best = sample;
    },
    /** Forget all samples — after a TOO_EARLY the phone's clock is evidently off. */
    reset(): void {
      best = null;
    },
    /** 0 until the first sample arrives (the welcome's serverTime gives a rough one). */
    get offset(): number {
      return best?.offset ?? 0;
    },
    get synced(): boolean {
      return best !== null;
    },
    /** The server's current time, as well as this phone can tell (epoch ms). */
    serverNow(): number {
      return phoneNow() + (best?.offset ?? 0);
    },
  };
}
