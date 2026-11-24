// The ranking board's pure rules (G-36, G-24): placing, dropping, and telling a tap from a drag.
// The pointer wiring itself is covered by the Playwright drag test (e2e/ranking.spec.ts).
import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATES } from '../../src/shared/constants';
import {
  DRAG_SLOP_PX,
  drop,
  dragStartFor,
  dropAttribute,
  held,
  IDLE,
  isComplete,
  move,
  parseDropAttribute,
  place,
  press,
  sameTarget,
  unplace,
  type DropTarget,
} from '../../src/client/ranking/gesture';
import { P } from '../fixtures/common';

describe('placement', () => {
  const empty = [null, null, null] as const;

  it('places, swaps between spots, and takes a player back out', () => {
    let p = place(empty, P.aino, 0);
    p = place(p, P.ville, 1);
    expect(p).toEqual([P.aino, P.ville, null]);
    p = place(p, P.aino, 1); // onto an occupied spot → swap
    expect(p).toEqual([P.ville, P.aino, null]);
    p = place(p, P.sanna, 0); // from the list onto an occupied spot → the occupant goes back
    expect(p).toEqual([P.sanna, P.aino, null]);
    expect(isComplete(p)).toBe(false);
    p = place(p, P.mikko, 2);
    expect(isComplete(p)).toBe(true);
    expect(unplace(p, P.aino)).toEqual([P.sanna, null, P.mikko]);
  });

  it('a player moved onto an empty spot leaves its old spot empty', () => {
    expect(place([P.aino, null, null], P.aino, 2)).toEqual([null, null, P.aino]);
  });

  it('dropping: on a spot places, on the list takes out, nowhere changes nothing', () => {
    const p = [P.aino, P.ville, null] as const;
    expect(drop(p, P.sanna, { kind: 'spot', spot: 2 })).toEqual([P.aino, P.ville, P.sanna]);
    expect(drop(p, P.aino, { kind: 'pool' })).toEqual([null, P.ville, null]);
    expect(drop(p, P.aino, null)).toBe(p); // same object: the board skips the update
  });
});

describe('drop targets', () => {
  it('round-trip through the data-drop attribute; anything else is no target', () => {
    const targets: DropTarget[] = [
      { kind: 'pool' },
      { kind: 'spot', spot: 0 },
      { kind: 'spot', spot: 24 },
    ];
    for (const target of targets) expect(parseDropAttribute(dropAttribute(target))).toEqual(target);
    expect(parseDropAttribute(undefined)).toBeNull();
    expect(parseDropAttribute('spot:')).toBeNull();
    expect(parseDropAttribute('spot:-1')).toBeNull();
  });

  it('sameTarget compares by meaning', () => {
    expect(sameTarget({ kind: 'spot', spot: 1 }, { kind: 'spot', spot: 1 })).toBe(true);
    expect(sameTarget({ kind: 'spot', spot: 1 }, { kind: 'spot', spot: 2 })).toBe(false);
    expect(sameTarget({ kind: 'pool' }, { kind: 'pool' })).toBe(true);
    expect(sameTarget({ kind: 'pool' }, null)).toBe(false);
    expect(sameTarget(null, null)).toBe(true);
  });
});

describe('tap or drag', () => {
  it('short lists drag at once; lists longer than any Spotlight question need a hold', () => {
    expect(dragStartFor(3)).toBe('immediate');
    expect(dragStartFor(MAX_CANDIDATES)).toBe('immediate');
    expect(dragStartFor(MAX_CANDIDATES + 1)).toBe('hold');
    expect(dragStartFor(25)).toBe('hold');
  });

  it('immediate: finger jitter is still a tap; moving past the slop starts the drag', () => {
    const pressed = press(P.aino, 'immediate', 100, 100);
    expect(move(pressed, 100 + DRAG_SLOP_PX - 1, 100)).toBe(pressed);
    const dragging = move(pressed, 100, 100 + DRAG_SLOP_PX);
    expect(dragging).toEqual({ kind: 'dragging', playerId: P.aino, x: 100, y: 100 + DRAG_SLOP_PX });
    expect(move(dragging, 5, 6)).toEqual({ kind: 'dragging', playerId: P.aino, x: 5, y: 6 });
    expect(held(pressed)).toBe(pressed); // holding means nothing in immediate mode
  });

  it('hold: moving before the hold is a scroll (gives up); resting lifts the player', () => {
    const pressed = press(P.ville, 'hold', 50, 50);
    expect(move(pressed, 50, 50 + DRAG_SLOP_PX)).toBe(IDLE);
    const lifted = held(pressed);
    expect(lifted).toEqual({ kind: 'dragging', playerId: P.ville, x: 50, y: 50 });
    expect(move(lifted, 60, 200)).toEqual({ kind: 'dragging', playerId: P.ville, x: 60, y: 200 });
  });

  it('nothing happens without a press', () => {
    expect(move(IDLE, 1, 2)).toBe(IDLE);
    expect(held(IDLE)).toBe(IDLE);
  });
});
