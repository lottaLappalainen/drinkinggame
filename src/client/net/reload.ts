// Automatic reloads are capped (CLAUDE.md §6): at most one per OUTDATED_RELOAD_MIN_INTERVAL_MS,
// shared by OUTDATED_CLIENT and a lazy chunk that vanished after a deploy (`vite:preloadError`).
// A cached old bundle would otherwise reload forever; after the cap the phone shows
// "Please refresh the page" instead.
import { OUTDATED_RELOAD_MIN_INTERVAL_MS } from '../../shared/constants';

export type ReloadGuard = {
  loadReloadedAt(): number | null;
  saveReloadedAt(at: number): void;
};

/** Reloads (and returns true) unless the last automatic reload was too recent. */
export function reloadOnce(guard: ReloadGuard, now: number, reload: () => void): boolean {
  const last = guard.loadReloadedAt();
  if (last !== null && now - last >= 0 && now - last < OUTDATED_RELOAD_MIN_INTERVAL_MS)
    return false;
  guard.saveReloadedAt(now);
  reload();
  return true;
}
