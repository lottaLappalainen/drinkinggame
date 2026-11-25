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
 * Where an element sits in the LAYOUT, as a border-box position from the page origin: built from
 * offsetLeft / offsetTop, which ignore CSS transforms and running animations, and don't change
 * when a container scrolls. getBoundingClientRect would include them, so a FLIP measured with it
 * saw "moves" that never happened: a hovered spot's scale (`spotOver`), or the previous FLIP still
 * running (each re-render then restarted a smaller slide: the drag twitch, 2026-11-25).
 */
function layoutPosition(element: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = element; node !== null;) {
    left += node.offsetLeft;
    top += node.offsetTop;
    const parent: HTMLElement | null =
      node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
    // offsetLeft is measured from the parent's padding edge: add its border to stay border-box.
    if (parent !== null) {
      left += parent.clientLeft;
      top += parent.clientTop;
    }
    node = parent;
  }
  return { left, top };
}

/** The ref `useFlip` returns: attach it to the list; `from` overrides where an item comes from. */
export type FlipRef<T extends HTMLElement> = {
  current: T | null;
  /**
   * Item `key` glides in from this viewport position on the next render instead of from its old
   * place — e.g. a dragged player dropped into a spot glides from where the finger let go.
   */
  from: (key: string, viewport: { left: number; top: number }) => void;
};

/**
 * FLIP for a list: children with `data-flip="<key>"` glide from where they were to where they are
 * after a re-render; new ones pop in. Attach the returned ref to the list element.
 */
export function useFlip<T extends HTMLElement>(): FlipRef<T> {
  const before = useRef(new Map<string, { left: number; top: number }>());
  const ref = useRef<FlipRef<T>>({
    current: null,
    from: (key, viewport) => {
      const list = ref.current.current;
      if (list === null) return;
      // A viewport point → the list's layout coordinates (as measured below): from the list's
      // border box, plus how far the list itself is scrolled.
      const origin = list.getBoundingClientRect();
      before.current.set(key, {
        left: viewport.left - origin.left + list.scrollLeft,
        top: viewport.top - origin.top + list.scrollTop,
      });
    },
  });

  useLayoutEffect(() => {
    const list = ref.current.current;
    if (list === null || typeof list.animate !== 'function') return;
    const duration = tokenMs('--dur-base');
    const easing = tokenValue('--ease-out', 'ease-out');
    // Layout positions RELATIVE TO THE LIST: page scrolling is not movement, and neither are
    // transforms or animations (see layoutPosition).
    const origin = layoutPosition(list);
    const now = new Map<string, { left: number; top: number }>();
    for (const element of Array.from(list.querySelectorAll<HTMLElement>('[data-flip]'))) {
      const key = element.dataset.flip ?? '';
      const box = layoutPosition(element);
      const rect = { left: box.left - origin.left, top: box.top - origin.top };
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

  return ref.current;
}
