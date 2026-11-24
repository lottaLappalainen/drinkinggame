// Light / dark theme (G-7): System (follows the phone), Light or Dark — a per-phone choice in
// localStorage, never sent to the server. index.html's inline script applies the saved choice
// before the first paint; this module switches it later (with a View Transition cross-fade) and
// follows the phone's setting while "System" is chosen.
import { signal } from '@preact/signals';
import type { Storage, Theme } from './storage';

export type { Theme } from './storage';

/** The current choice (for the pickers). */
export const themeChoice = signal<Theme>('system');

let systemQuery: MediaQueryList | null = null;

function resolve(choice: Theme): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return systemQuery?.matches === true ? 'dark' : 'light';
}

function paint(choice: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = resolve(choice);
  // theme-color follows the page background — read from the tokens, no raw colors here.
  const background = getComputedStyle(root).getPropertyValue('--color-background').trim();
  if (background !== '')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
}

/** Read the saved choice and keep following the phone's setting. Called once from main.tsx. */
export function initTheme(storage: Storage): void {
  themeChoice.value = storage.loadTheme();
  try {
    systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
    systemQuery.addEventListener('change', () => {
      if (themeChoice.value === 'system') paint('system');
    });
  } catch {
    systemQuery = null;
  }
  paint(themeChoice.value);
}

/** The user picked a theme: save it and switch with a cross-fade (plain switch if unsupported). */
export function setTheme(storage: Storage, choice: Theme): void {
  themeChoice.value = choice;
  storage.saveTheme(choice);
  withViewTransition(() => {
    paint(choice);
  });
}

/** Run a DOM change as a View Transition where the browser has them (and motion is welcome). */
export function withViewTransition(change: () => void): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof document.startViewTransition !== 'function') {
    change();
    return;
  }
  document.startViewTransition(change);
}
