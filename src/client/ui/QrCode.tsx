// The join QR code — the main way to join (G-12b). Its library is imported dynamically, so it is
// downloaded only when a lobby shows a code and never counts toward the first page load.
// Drawn as one SVG path from the module matrix (no injected HTML).
import { useEffect, useState } from 'preact/hooks';
import { STRINGS } from '../strings';
import { Spinner } from './Feedback';
import styles from './Game.module.css';

type Matrix = readonly (readonly boolean[])[];

function pathOf(matrix: Matrix): string {
  let path = '';
  matrix.forEach((row, y) => {
    row.forEach((on, x) => {
      if (on) path += `M${String(x)} ${String(y)}h1v1h-1z`;
    });
  });
  return path;
}

export function QrCode(props: { value: string; label: string }) {
  const [matrix, setMatrix] = useState<Matrix | null>(null);

  useEffect(() => {
    let cancelled = false;
    void import('uqr')
      .then(({ encode }) => {
        if (!cancelled) setMatrix(encode(props.value, { border: 1 }).data);
      })
      .catch(() => {
        // The link next to the code still works; vite:preloadError handles a stale chunk.
      });
    return () => {
      cancelled = true;
    };
  }, [props.value]);

  if (matrix === null)
    return (
      <div class={`${styles.qr ?? ''} ${styles.qrPlaceholder ?? ''}`}>
        <Spinner label={STRINGS.common.loading} />
      </div>
    );
  const size = matrix.length;
  return (
    <svg
      class={styles.qr}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={props.label}
      shape-rendering="crispEdges"
    >
      <path class={styles.qrModules} d={pathOf(matrix)} />
    </svg>
  );
}
