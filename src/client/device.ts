// Small device features: Screen Wake Lock while in a game, and the in-app browser hint.
import { useEffect } from 'preact/hooks';

/**
 * Keep the screen on while `active` (CLAUDE.md §7 Client). The browser drops the lock whenever the
 * page is hidden, so it is requested again on every return to visible. Silent where unsupported.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (stopped) void sentinel.release();
          else lock = sentinel;
        })
        .catch(() => undefined); // low battery, not allowed, … — the game works without it
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

/**
 * Chat apps (WhatsApp, Instagram, Facebook, …) open links in their own browser, whose storage
 * isn't the phone's real browser — a later open in Safari / Chrome would be a new player (G-12b).
 */
export function isInAppBrowser(userAgent: string): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Snapchat|Line\/|MicroMessenger|TikTok|musical_ly|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(
    userAgent,
  );
}
