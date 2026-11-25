// What every screen gets besides its snapshot: the clock, the intents, which requests are in
// flight. The app provides the real store; the dev screen gallery provides a frozen clock and
// no-op intents — so the very same screens render live data or fixtures (5A "done when").
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { PresetId } from '../../shared/avatars';
import type { PlayerId, RequestId, Settings } from '../../shared/protocol';
import type { PendingRequest } from '../store/types';

/** The intents screens may call (a subset of the store's — see store/store.ts). */
export type Actions = {
  updateProfile: (patch: { nickname?: string; presetId?: PresetId }) => boolean;
  setSettings: (settings: Settings) => boolean;
  start: () => boolean;
  submit: (ranking: readonly PlayerId[]) => boolean;
  advance: () => boolean;
  endGame: () => boolean;
  playAgain: () => boolean;
  leave: () => void;
  removePlayer: (playerId: PlayerId) => boolean;
  answerReclaim: (requestId: RequestId, approve: boolean) => boolean;
  goHome: () => void;
  editProfile: () => void;
};

export type ScreenEnv = {
  /** The server's time (epoch ms). Frozen at the fixture's `now` in the gallery. */
  readonly serverNow: () => number;
  /** Gallery: never schedule re-renders, pause CSS timers. */
  readonly frozen: boolean;
  readonly actions: Actions;
  readonly pending: ReadonlySet<PendingRequest>;
};

const noop = () => false;

export const FROZEN_ACTIONS: Actions = {
  updateProfile: noop,
  setSettings: noop,
  start: noop,
  submit: noop,
  advance: noop,
  endGame: noop,
  playAgain: noop,
  leave: () => undefined,
  removePlayer: noop,
  answerReclaim: noop,
  goHome: () => undefined,
  editProfile: () => undefined,
};

export const ScreenEnvContext = createContext<ScreenEnv>({
  serverNow: () => Date.now(),
  frozen: true,
  actions: FROZEN_ACTIONS,
  pending: new Set(),
});

export function useEnv(): ScreenEnv {
  return useContext(ScreenEnvContext);
}

/**
 * Re-render once at `at` (server time) — the next step boundary from shared/timeline.ts or
 * shared/reveal.ts. One timer, never per frame (Phase 2 review). Returns the current server time.
 */
export function useNowUntil(at: number | null): number {
  const env = useEnv();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (env.frozen || at === null) return;
    const delay = Math.max(0, at - env.serverNow()) + 15; // land just past the boundary
    const id = window.setTimeout(() => {
      setTick((n) => n + 1);
    }, delay);
    return () => {
      window.clearTimeout(id);
    };
  }, [at, env]);
  return env.serverNow();
}
