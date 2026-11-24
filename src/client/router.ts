// Routes (G-17): `/` (Profile / Home) and `/g/<KEY>` (everything inside a game), plus the dev
// galleries `/dev/ui`, `/dev/screens` and the ranking test page `/dev/ranking` (dev + staging builds only). The game SCREEN comes from
// the store, never from the URL — so refresh and Back always land correctly.
import { signal } from '@preact/signals';
import type { GameKey } from '../shared/protocol';
import { isGameKey } from './storage';

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'game'; readonly key: GameKey }
  | { readonly name: 'devUi' }
  | { readonly name: 'devScreens' }
  | { readonly name: 'devRanking' };

export function parseRoute(pathname: string): Route {
  const game = /^\/g\/([^/]+)\/?$/.exec(pathname);
  const key = game?.[1]?.toUpperCase();
  if (key !== undefined && isGameKey(key)) return { name: 'game', key };
  if (pathname === '/dev/ui') return { name: 'devUi' };
  if (pathname === '/dev/screens') return { name: 'devScreens' };
  if (pathname === '/dev/ranking') return { name: 'devRanking' };
  return { name: 'home' };
}

export function gamePath(key: GameKey): string {
  return `/g/${key}`;
}

export const route = signal<Route>({ name: 'home' });

/**
 * How the current route was reached. A game URL reached by Back / Forward ('history') must never
 * JOIN by itself — after LEFT / REMOVED the login is gone, and joining needs an explicit Join tap
 * (CLAUDE.md §5). Opening a join link ('load') or tapping Join / Host in the app ('app') may.
 */
export type NavigationCause = 'load' | 'app' | 'history';
export const navigationCause = signal<NavigationCause>('load');

/** Called once from main.tsx. */
export function initRouter(): void {
  route.value = parseRoute(location.pathname);
  window.addEventListener('popstate', () => {
    navigationCause.value = 'history';
    route.value = parseRoute(location.pathname);
  });
}

export function navigate(path: string, options: { replace?: boolean } = {}): void {
  if (location.pathname !== path) {
    if (options.replace === true) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
  }
  navigationCause.value = 'app';
  route.value = parseRoute(path);
}
