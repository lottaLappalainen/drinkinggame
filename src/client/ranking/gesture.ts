// The ranking board's pure logic (G-36): placing players in spots and telling a tap from a drag.
// No DOM here, so all of it is unit-tested in Node; RankingBoard.tsx only feeds it pointer
// positions and the clock.
import { MAX_CANDIDATES } from '../../shared/constants';
import type { PlayerId } from '../../shared/protocol';

/** Spot i holds the player placed there, or null while empty. Local state until Ready. */
export type Placement = readonly (PlayerId | null)[];

/** Every spot filled → Ready is allowed (and the placement is exactly a valid `submit`). */
export function isComplete(placement: Placement): placement is readonly PlayerId[] {
  return placement.every((id) => id !== null);
}

/** Put `playerId` into `spot`. From another spot → the two swap; from the list → the occupant goes back. */
export function place(placement: Placement, playerId: PlayerId, spot: number): Placement {
  const next = [...placement];
  const from = next.indexOf(playerId);
  const occupant = next[spot] ?? null;
  next[spot] = playerId;
  if (from !== -1) next[from] = occupant;
  return next;
}

/** Take `playerId` out of the spots (back to the list). */
export function unplace(placement: Placement, playerId: PlayerId): Placement {
  return placement.map((id) => (id === playerId ? null : id));
}

/** Where a dragged player can land: a spot, or the list of unplaced players. */
export type DropTarget =
  { readonly kind: 'spot'; readonly spot: number } | { readonly kind: 'pool' };

export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === 'spot' && b.kind === 'spot' ? a.spot === b.spot : a.kind === b.kind;
}

/** The placement after dropping `playerId` on `target` (null = dropped nowhere → no change). */
export function drop(
  placement: Placement,
  playerId: PlayerId,
  target: DropTarget | null,
): Placement {
  if (target === null) return placement;
  return target.kind === 'spot'
    ? place(placement, playerId, target.spot)
    : unplace(placement, playerId);
}

/** `data-drop` values on the board's elements ↔ drop targets. */
export function dropAttribute(target: DropTarget): string {
  return target.kind === 'spot' ? `spot:${String(target.spot)}` : 'pool';
}

export function parseDropAttribute(value: string | undefined): DropTarget | null {
  if (value === 'pool') return { kind: 'pool' };
  const spot = /^spot:(\d+)$/.exec(value ?? '')?.[1];
  return spot === undefined ? null : { kind: 'spot', spot: Number(spot) };
}

// ── Tap or drag ──────────────────────────────────────────────────────────────

/**
 * How a press becomes a drag:
 * - `immediate`: moving the finger drags at once. For short lists that never need scrolling
 *   (Spotlight, ≤ MAX_CANDIDATES), whose items block page scrolling (`touch-action: none`).
 * - `hold`: press and hold HOLD_TO_DRAG_MS first; moving earlier is a scroll, not a drag. For the
 *   long Podium list, which must stay scrollable with the same finger.
 */
export type DragStart = 'immediate' | 'hold';

/**
 * Short lists never scroll, so a drag may start at once; the long Podium list must stay
 * scrollable with the same finger, so there a player is lifted by press-and-hold.
 */
export function dragStartFor(candidateCount: number): DragStart {
  return candidateCount > MAX_CANDIDATES ? 'hold' : 'immediate';
}

/** Movement under this is still a tap (finger jitter). */
export const DRAG_SLOP_PX = 8;
/** How long a press must rest before it lifts the player in `hold` mode. */
export const HOLD_TO_DRAG_MS = 280;

export type Gesture =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'pressed';
      readonly playerId: PlayerId;
      readonly start: DragStart;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: 'dragging';
      readonly playerId: PlayerId;
      readonly x: number;
      readonly y: number;
    };

export const IDLE: Gesture = { kind: 'idle' };

export function press(playerId: PlayerId, start: DragStart, x: number, y: number): Gesture {
  return { kind: 'pressed', playerId, start, x, y };
}

/** The finger moved. A press that moves far enough drags (`immediate`) or gives up (`hold` → scroll). */
export function move(gesture: Gesture, x: number, y: number): Gesture {
  switch (gesture.kind) {
    case 'idle':
      return gesture;
    case 'pressed':
      if (Math.hypot(x - gesture.x, y - gesture.y) < DRAG_SLOP_PX) return gesture;
      return gesture.start === 'immediate'
        ? { kind: 'dragging', playerId: gesture.playerId, x, y }
        : IDLE;
    case 'dragging':
      return { ...gesture, x, y };
    default: {
      const unknown: never = gesture;
      return unknown;
    }
  }
}

/** HOLD_TO_DRAG_MS passed without the finger moving: a `hold` press lifts the player. */
export function held(gesture: Gesture): Gesture {
  return gesture.kind === 'pressed' && gesture.start === 'hold'
    ? { kind: 'dragging', playerId: gesture.playerId, x: gesture.x, y: gesture.y }
    : gesture;
}
