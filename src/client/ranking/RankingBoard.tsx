// The ranking board (G-36, G-24): put players into spots by DRAGGING them (Pointer Events — no
// drag-and-drop library, the HTML5 DnD API doesn't work on phones) or by TAPPING a player, then a
// spot. One component for both modes — it only follows `spots`: Spotlight fills every spot,
// Podium the top 3 above a scrollable list of everyone. Local state until Ready (the screen sends
// it). The placing and tap-or-drag rules are pure functions in ./gesture.ts.
//
// Mobile details (CLAUDE.md §7 "Drag-to-rank"): pointer capture so the drag follows the finger
// anywhere; `pointercancel` puts the player back; no text selection / callout / context menu;
// the dragged copy follows the finger via `transform` only, written straight to the element (no
// re-render per move); drag areas stay off the screen edges (iOS swipe-back).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { PlayerId, PublicPlayer } from '../../shared/protocol';
import { STRINGS } from '../strings';
import { cx } from '../ui/cx';
import { PlayerAvatar, type PhotoSource } from '../ui/Game';
import { useFlip } from '../ui/motion';
import {
  drop,
  dropAttribute,
  dragStartFor,
  held,
  HOLD_TO_DRAG_MS,
  IDLE,
  move,
  parseDropAttribute,
  place,
  press,
  sameTarget,
  unplace,
  type DropTarget,
  type Gesture,
  type Placement,
} from './gesture';
import styles from './RankingBoard.module.css';

/** A short buzz on pick-up and drop, where the phone can (never on iOS Safari — silently). */
function buzz(): void {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(10);
  } catch {
    // Some browsers throw instead of ignoring it (e.g. before any user gesture).
  }
}

type Drag = { readonly playerId: PlayerId; readonly over: DropTarget | null };

export function RankingBoard(props: {
  candidates: readonly PublicPlayer[];
  spots: number;
  /** The caption of a spot (0-based) — top / 2nd / 3rd / bottom words; null = number only. */
  captionFor: (spot: number) => string | null;
  placement: Placement;
  onChange: (placement: Placement) => void;
  source?: PhotoSource | undefined;
  disabled?: boolean;
}) {
  const { placement } = props;
  const [selected, setSelected] = useState<PlayerId | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(IDLE);
  const holdTimer = useRef<number | null>(null);
  const swallowClick = useRef(false);
  // Separate FLIP scopes: the pinned Podium spots move relative to the list when the page scrolls.
  const spotsFlip = useFlip<HTMLOListElement>();
  const poolFlip = useFlip<HTMLUListElement>();

  const byId = new Map(props.candidates.map((p) => [p.playerId, p]));
  const placed = new Set(placement.filter((id): id is PlayerId => id !== null));
  const unplaced = props.candidates.filter((p) => !placed.has(p.playerId));
  const partial = props.spots < props.candidates.length;
  const dragStart = dragStartFor(props.candidates.length);
  const dragFromSpot = drag !== null && placed.has(drag.playerId);

  /** Apply a new placement; players changing between spots and list glide from where they were. */
  const commit = (next: Placement, droppedAt?: { id: PlayerId; left: number; top: number }) => {
    const before = new Set(placement.filter((id): id is PlayerId => id !== null));
    const after = new Set(next.filter((id): id is PlayerId => id !== null));
    for (const id of new Set([...before, ...after])) {
      if (before.has(id) === after.has(id)) continue; // same container: the list's own FLIP
      const from =
        droppedAt?.id === id
          ? droppedAt
          : root.current?.querySelector(`[data-flip="${id}"]`)?.getBoundingClientRect();
      if (from === undefined) continue;
      (after.has(id) ? spotsFlip : poolFlip).from(id, from);
    }
    props.onChange(next);
  };

  // ── Tap, then tap ──────────────────────────────────────────────────────────

  /** A click that ends a drag is not a tap. */
  const tapAllowed = () => {
    if (!swallowClick.current) return true;
    swallowClick.current = false;
    return false;
  };
  const tapSpot = (spot: number) => {
    if (!tapAllowed()) return;
    const occupant = placement[spot] ?? null;
    if (selected !== null) {
      commit(place(placement, selected, spot));
      setSelected(null);
    } else if (occupant !== null) setSelected(occupant);
  };
  const tapCandidate = (playerId: PlayerId) => {
    if (!tapAllowed()) return;
    setSelected(selected === playerId ? null : playerId);
  };
  const tapPool = () => {
    if (!tapAllowed()) return;
    // A placed player selected, then the list tapped: back out of the spots.
    if (selected !== null && placed.has(selected)) {
      commit(unplace(placement, selected));
      setSelected(null);
    }
  };

  // ── Drag ───────────────────────────────────────────────────────────────────

  const stopHoldTimer = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const moveGhost = (x: number, y: number) => {
    const element = ghost.current;
    if (element !== null) element.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
  };

  /** The drop target under the finger (the ghost itself ignores pointers). */
  const targetAt = (x: number, y: number): DropTarget | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
    if (hit == null || root.current?.contains(hit) !== true) return null;
    return parseDropAttribute(hit.dataset.drop);
  };

  const lift = (playerId: PlayerId) => {
    stopHoldTimer();
    setSelected(null);
    setDrag({ playerId, over: null });
    buzz();
  };

  const endDrag = () => {
    stopHoldTimer();
    gesture.current = IDLE;
    setDrag(null);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (props.disabled === true || gesture.current.kind !== 'idle') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    const handle = event.target.closest<HTMLElement>('[data-drag]');
    // Look the id up among the candidates rather than trusting the attribute's string.
    const playerId = props.candidates.find((p) => p.playerId === handle?.dataset.drag)?.playerId;
    if (handle === null || playerId === undefined) return;
    gesture.current = press(playerId, dragStart, event.clientX, event.clientY);
    // Capture: the drag keeps following the finger even outside the board.
    handle.setPointerCapture(event.pointerId);
    if (dragStart === 'hold')
      holdTimer.current = window.setTimeout(() => {
        holdTimer.current = null;
        const next = held(gesture.current);
        if (next.kind === 'dragging') {
          gesture.current = next;
          lift(next.playerId);
        }
      }, HOLD_TO_DRAG_MS);
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = gesture.current;
    if (previous.kind === 'idle') return;
    const next = move(previous, event.clientX, event.clientY);
    gesture.current = next;
    if (next.kind === 'idle') {
      stopHoldTimer(); // moved before the hold: it's a scroll — let the browser have it
      return;
    }
    if (next.kind !== 'dragging') return;
    if (previous.kind === 'pressed') lift(next.playerId);
    moveGhost(next.x, next.y);
    const over = targetAt(next.x, next.y);
    setDrag((current) =>
      current === null || sameTarget(current.over, over) ? current : { ...current, over },
    );
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = gesture.current;
    if (current.kind !== 'dragging') {
      endDrag(); // a plain tap: its click follows and does the work
      return;
    }
    swallowClick.current = true; // the click after this pointerup is not a tap
    window.setTimeout(() => {
      swallowClick.current = false; // …and if no click comes, don't eat the next real tap
    }, 0);
    const target = targetAt(event.clientX, event.clientY);
    const box = ghost.current?.getBoundingClientRect();
    const next = drop(placement, current.playerId, target);
    endDrag();
    if (next === placement) return;
    buzz();
    commit(next, box && { id: current.playerId, left: box.left, top: box.top });
  };

  // The system took the touch over (incoming call, edge gesture, …): put the player back.
  const onPointerCancel = () => {
    endDrag();
  };

  // While dragging, the page must not scroll. `touch-action: none` covers the short lists; the
  // long list keeps `pan-y` for scrolling, so a lifted drag there blocks the touch's scroll here
  // (a non-passive listener — Preact can't set `passive: false`).
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    const block = (event: TouchEvent) => {
      if (gesture.current.kind === 'dragging') event.preventDefault();
    };
    element.addEventListener('touchmove', block, { passive: false });
    return () => {
      element.removeEventListener('touchmove', block);
      stopHoldTimer();
    };
  }, []);

  // Place the ghost under the finger before it is first painted (no flash at the corner).
  useLayoutEffect(() => {
    const current = gesture.current;
    if (drag !== null && current.kind === 'dragging') moveGhost(current.x, current.y);
  }, [drag?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps -- only when a drag starts

  const dragged = drag !== null ? byId.get(drag.playerId) : undefined;
  const handleClass = dragStart === 'hold' ? styles.handleHold : styles.handleImmediate;
  const showPool =
    unplaced.length > 0 || (selected !== null && placed.has(selected)) || dragFromSpot;

  return (
    <div
      ref={root}
      class={cx(styles.board, drag !== null && styles.boardDragging)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => {
        event.preventDefault(); // Android's long-press menu would end a hold-to-drag
      }}
    >
      <ol
        ref={spotsFlip}
        class={cx(styles.spots, partial && styles.spotsPinned)}
        aria-label={STRINGS.ranking.spots}
      >
        {placement.map((id, spot) => {
          const player = id !== null ? byId.get(id) : undefined;
          const caption = props.captionFor(spot);
          const target: DropTarget = { kind: 'spot', spot };
          return (
            <li key={spot}>
              <button
                type="button"
                class={cx(
                  styles.spot,
                  player !== undefined && styles.spotFilled,
                  player !== undefined && handleClass,
                  id !== null && id === selected && styles.spotSelected,
                  sameTarget(drag?.over ?? null, target) && styles.spotOver,
                )}
                data-drop={dropAttribute(target)}
                data-drag={player?.playerId}
                disabled={props.disabled}
                onClick={() => {
                  tapSpot(spot);
                }}
              >
                <span class={styles.spotNumber}>{spot + 1}</span>
                {player !== undefined ? (
                  <span
                    class={cx(styles.spotPlayer, drag?.playerId === id && styles.lifted)}
                    data-flip={player.playerId}
                  >
                    <PlayerAvatar player={player} source={props.source} size="sm" />
                    <span class={styles.spotBody}>
                      {caption !== null && <span class={styles.spotCaption}>{caption}</span>}
                      <span class={styles.spotName}>{player.nickname}</span>
                    </span>
                  </span>
                ) : (
                  <span class={styles.spotBody}>
                    {caption !== null && <span class={styles.spotCaption}>{caption}</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      {showPool && (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the list's own buttons are the keyboard path; this only catches "tap outside a spot"
        <ul
          ref={poolFlip}
          class={cx(
            styles.pool,
            sameTarget(drag?.over ?? null, { kind: 'pool' }) && dragFromSpot && styles.poolOver,
          )}
          aria-label={STRINGS.ranking.pool}
          data-drop={dropAttribute({ kind: 'pool' })}
          onClick={tapPool}
        >
          {unplaced.map((player) => (
            <li key={player.playerId}>
              <button
                type="button"
                class={cx(
                  styles.candidate,
                  handleClass,
                  selected === player.playerId && styles.candidateSelected,
                  drag?.playerId === player.playerId && styles.lifted,
                )}
                aria-pressed={selected === player.playerId}
                data-drag={player.playerId}
                data-flip={player.playerId}
                disabled={props.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  tapCandidate(player.playerId);
                }}
              >
                <PlayerAvatar player={player} source={props.source} size="md" />
                <span class={styles.candidateName}>{player.nickname}</span>
              </button>
            </li>
          ))}
          {unplaced.length === 0 && <li class={styles.poolHint}>{STRINGS.ranking.dropToRemove}</li>}
        </ul>
      )}
      {dragged !== undefined && (
        <div ref={ghost} class={styles.ghost} aria-hidden="true">
          <div class={styles.ghostChip}>
            <PlayerAvatar player={dragged} source={props.source} size="sm" />
            <span class={styles.spotName}>{dragged.nickname}</span>
          </div>
        </div>
      )}
    </div>
  );
}
