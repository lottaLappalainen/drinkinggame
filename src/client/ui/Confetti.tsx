// Confetti behind the "most likely" reveal (G-50: the top step gets the biggest emphasis). Pure
// decoration: one burst of falling pieces, CSS keyframes on transform / opacity only, no timers and
// no re-renders. Hidden for reduced motion and from screen readers.
import { useMemo } from 'preact/hooks';
import { cx } from './cx';
import styles from './Confetti.module.css';

const PIECES = 48;
const TONES = [styles.tone1, styles.tone2, styles.tone3, styles.tone4];

/**
 * A fixed scramble in [0, 1) per piece and property (integer hash), so position, delay, speed and
 * spin are unrelated — no neat diagonal lines — yet every render draws the same picture.
 */
function spread(i: number, salt: number): number {
  let h = Math.imul(i + 1, 0x9e37_79b1) ^ Math.imul(salt + 1, 0x85eb_ca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b_3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 0x1_0000_0000;
}

export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => ({
        x: Math.round(spread(i, 1) * 100), // % across the screen
        delayMs: Math.round(spread(i, 2) * 700),
        speed: 0.75 + spread(i, 3) * 0.5, // × the fall duration token
        drift: Math.round((spread(i, 4) - 0.5) * 2 * 100) / 100, // −1 … 1 × the drift token
        spin: Math.round((spread(i, 5) * 3 - 1.5) * 100) / 100, // turns
        tone: TONES[i % TONES.length],
      })),
    [],
  );
  return (
    <div class={styles.confetti} aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          class={cx(styles.piece, p.tone)}
          // eslint-disable-next-line no-restricted-syntax -- per-piece values, as CSS variables only (CLAUDE.md §7 allows this)
          style={{
            '--x': String(p.x),
            '--delay': `${String(p.delayMs)}ms`,
            '--speed': String(p.speed),
            '--drift': String(p.drift),
            '--spin': String(p.spin),
          }}
        />
      ))}
    </div>
  );
}
