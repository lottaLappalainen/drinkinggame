// A place number in front of a player in the full ranking (G-50): 1 / 2 / 3 as gold / silver /
// bronze medals, 4th and below as a plain number of the same size, so the column reads at a glance.
// The caller passes the PLACE, not the row position: tied players share the number and the medal.
import { ordinal } from '../../shared/questionLabels';
import { cx } from './cx';
import styles from './PlaceNumber.module.css';

const MEDAL: readonly (string | undefined)[] = [styles.gold, styles.silver, styles.bronze];

export function PlaceNumber(props: { place: number }) {
  const medal = MEDAL[props.place - 1];
  return (
    <span class={cx(styles.place, medal !== undefined && styles.medal, medal)}>
      <span aria-hidden="true">{props.place}</span>
      {/* Screen readers hear "1st", then the player's name from the row. */}
      <span class={styles.screenReaderOnly}>{ordinal(props.place)}</span>
    </span>
  );
}
