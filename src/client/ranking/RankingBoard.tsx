// INTERIM ranking board (G-36): tap a player, then a spot. Lets the game be played on real phones
// before 5B builds the drag-to-rank board from the prototype test (U5). One component for both
// modes — it just follows `spots` (G-24): Spotlight fills every spot, Podium the top 3 above a
// list of everyone. Local state only until Ready (the screen sends it).
import { useState } from 'preact/hooks';
import type { PlayerId, PublicPlayer } from '../../shared/protocol';
import { STRINGS } from '../strings';
import { cx } from '../ui/cx';
import { PlayerAvatar, type PhotoSource } from '../ui/Game';
import styles from './RankingBoard.module.css';

export type Placement = readonly (PlayerId | null)[];

/** A placement is complete when every spot is filled. */
export function isComplete(placement: Placement): placement is readonly PlayerId[] {
  return placement.every((id) => id !== null);
}

/** Pure placement logic (tested): put `playerId` into `spot`, swapping with whoever was there. */
export function place(placement: Placement, playerId: PlayerId, spot: number): Placement {
  const next = [...placement];
  const from = next.indexOf(playerId);
  const occupant = next[spot] ?? null;
  next[spot] = playerId;
  if (from !== -1) next[from] = occupant; // moved between spots → swap
  return next;
}

export function unplace(placement: Placement, playerId: PlayerId): Placement {
  return placement.map((id) => (id === playerId ? null : id));
}

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
  const [selected, setSelected] = useState<PlayerId | null>(null);
  const byId = new Map(props.candidates.map((p) => [p.playerId, p]));
  const placed = new Set(props.placement.filter((id): id is PlayerId => id !== null));
  const unplaced = props.candidates.filter((p) => !placed.has(p.playerId));

  const tapSpot = (spot: number) => {
    const occupant = props.placement[spot] ?? null;
    if (selected !== null) {
      props.onChange(place(props.placement, selected, spot));
      setSelected(null);
    } else if (occupant !== null) setSelected(occupant);
  };
  const tapCandidate = (playerId: PlayerId) => {
    setSelected(selected === playerId ? null : playerId);
  };
  const tapPool = () => {
    // A placed player selected, then the list tapped: back out of the spots.
    if (selected !== null && placed.has(selected)) {
      props.onChange(unplace(props.placement, selected));
      setSelected(null);
    }
  };

  return (
    <div class={styles.board}>
      <ol class={styles.spots}>
        {props.placement.map((id, spot) => {
          const player = id !== null ? byId.get(id) : undefined;
          const caption = props.captionFor(spot);
          return (
            <li key={spot}>
              <button
                type="button"
                class={cx(
                  styles.spot,
                  player !== undefined && styles.spotFilled,
                  id !== null && id === selected && styles.spotSelected,
                )}
                disabled={props.disabled}
                onClick={() => {
                  tapSpot(spot);
                }}
              >
                <span class={styles.spotNumber}>{spot + 1}</span>
                {player !== undefined && (
                  <PlayerAvatar player={player} source={props.source} size="sm" />
                )}
                <span class={styles.spotBody}>
                  {caption !== null && <span class={styles.spotCaption}>{caption}</span>}
                  <span class={styles.spotName}>{player?.nickname ?? ''}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {unplaced.length > 0 || (selected !== null && placed.has(selected)) ? (
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the list's own buttons are the keyboard path; this only catches "tap outside a spot"
        <ul class={styles.pool} aria-label={STRINGS.round.tapToPlace} onClick={tapPool}>
          {unplaced.map((player) => (
            <li key={player.playerId}>
              <button
                type="button"
                class={cx(
                  styles.candidate,
                  selected === player.playerId && styles.candidateSelected,
                )}
                aria-pressed={selected === player.playerId}
                disabled={props.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  tapCandidate(player.playerId);
                }}
              >
                <PlayerAvatar player={player} source={props.source} size="lg" />
                {player.nickname}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
