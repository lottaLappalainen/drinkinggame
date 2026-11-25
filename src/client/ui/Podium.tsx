// The podium tray of the reveal (G-50): once 2nd and 3rd place have had their big moment, they stay
// on screen under the big card, side by side in two equal halves: silver on the left, bronze on the
// right (user 2026-11-25). Each half is reserved from the start, so a card lands in its own place
// and never pushes the other; a reveal with only one of them (e.g. 3 players: no separate 3rd
// step) shows that card centred at half width. Each card flies in from the middle of the screen,
// where its big card just was. Keyed by slot, so a card already there never replays its entrance.
import type { PublicPlayer } from '../../shared/protocol';
import { cx } from './cx';
import { Avatar, photoUrl, type PhotoSource } from './Game';
import { PlaceNumber } from './PlaceNumber';
import styles from './Podium.module.css';

export type PodiumEntry = { readonly place: number; readonly players: readonly PublicPlayer[] };

export function PodiumTray(props: {
  /**
   * The podium slots this reveal has, left to right (silver, then bronze); `null` = not revealed
   * yet (its half stays empty). One slot = shown centred.
   */
  slots: readonly (PodiumEntry | null)[];
  source?: PhotoSource | undefined;
  /** Accessible name of the tray (e.g. "Revealed so far"). */
  label: string;
}) {
  const single = props.slots.length === 1;
  return (
    <ul class={cx(styles.tray, single && styles.single)} aria-label={props.label}>
      {props.slots.map((entry, index) =>
        entry === null ? (
          <li key={index} class={styles.empty} aria-hidden="true" />
        ) : (
          <li
            key={index}
            class={cx(
              styles.card,
              single ? styles.fromAbove : index === 0 ? styles.fromRight : styles.fromLeft,
            )}
          >
            <PlaceNumber place={entry.place} />
            <span class={styles.avatars}>
              {entry.players.map((player) => (
                <Avatar
                  key={player.playerId}
                  presetId={player.avatar.presetId}
                  photo={
                    props.source !== undefined && player.avatar.photoVersion !== null
                      ? photoUrl(props.source, player.playerId, player.avatar.photoVersion)
                      : null
                  }
                  size="sm"
                />
              ))}
            </span>
            <span class={styles.names}>{entry.players.map((p) => p.nickname).join(', ')}</span>
          </li>
        ),
      )}
    </ul>
  );
}
