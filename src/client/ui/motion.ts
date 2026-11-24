// Motion helpers on the Web Animations API (CLAUDE.md §7 "Styling & animation"): durations and
// easings come from the motion tokens, so prefers-reduced-motion (which shortens the tokens to
// 1 ms) applies here too. Only transform and opacity are ever animated.
import { useLayoutEffect, useRef } from 'preact/hooks';

/** A motion token in ms (`--dur-base: 250ms` → 250); `fallback` before styles load. */
export function tokenMs(name: string, fallback = 250): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return fallback;
    return raw.endsWith('ms') ? value : value * 1000;
  } catch {
    return fallback;
  }
}

function tokenValue(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

/**
 * FLIP for a list: children with `data-flip="<key>"` glide from where they were to where they are
 * after a re-render; new ones pop in. Attach the returned ref to the list element.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller picks the element type its ref prop needs
export function useFlip<T extends HTMLElement>(): { current: T | null } {
  const ref = useRef<T>(null);
  const before = useRef(new Map<string, DOMRect>());

  useLayoutEffect(() => {
    const list = ref.current;
    if (list === null || typeof list.animate !== 'function') return;
    const duration = tokenMs('--dur-base');
    const easing = tokenValue('--ease-out', 'ease-out');
    const now = new Map<string, DOMRect>();
    for (const element of Array.from(list.querySelectorAll<HTMLElement>('[data-flip]'))) {
      const key = element.dataset.flip ?? '';
      const rect = element.getBoundingClientRect();
      now.set(key, rect);
      const old = before.current.get(key);
      if (old === undefined) {
        if (before.current.size > 0)
          element.animate(
            [
              { transform: 'scale(0.6)', opacity: 0 },
              { transform: 'scale(1)', opacity: 1 },
            ],
            { duration, easing: tokenValue('--ease-spring', easing) },
          );
        continue;
      }
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (dx !== 0 || dy !== 0)
        element.animate(
          [{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }],
          { duration, easing },
        );
    }
    before.current = now;
  });

  return ref;
}
