// The podium tray of the reveal (G-50): once 3rd and 2nd place have had their big moment, they
// shrink into small cards at the bottom right and stay there (bronze in the corner, silver next to
// it) while the rest of the reveal plays. Each card flies in from the middle of the screen, where
// its big card just was. Mounted once per reveal and keyed by place, so a card that is already
// there never replays its entrance.
import type { PublicPlayer } from '../../shared/protocol';
import { Avatar, photoUrl, type PhotoSource } from './Game';
import { PlaceNumber } from './PlaceNumber';
import styles from './Podium.module.css';

export type PodiumEntry = { readonly place: number; readonly players: readonly PublicPlayer[] };

export function PodiumTray(props: {
  /** Revealed podium places so far (any order); shown best place first, so bronze ends up last. */
  entries: readonly PodiumEntry[];
  source?: PhotoSource | undefined;
  /** Accessible name of the tray (e.g. "Revealed so far"). */
  label: string;
}) {
  const entries = [...props.entries].sort((a, b) => a.place - b.place);
  return (
    <ul class={styles.tray} aria-label={props.label}>
      {entries.map((entry) => (
        <li key={entry.place} class={styles.card}>
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
      ))}
    </ul>
  );
}
