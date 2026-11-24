// Placeholder until the real screens (5A): proves the whole server path works from a phone through
// the real store and connection manager — create a game over HTTP, open its WebSocket, say hello,
// receive the lobby. Open it on staging to check a real phone (HTTPS). Deliberately unstyled —
// styling arrives with the design system.
import { useEffect } from 'preact/hooks';
import { appStore } from './store/app';

export function App() {
  const store = appStore();

  useEffect(() => {
    void store.hostGame({ nickname: 'Test phone', presetId: 'fox' });
    return () => {
      store.goHome();
    };
  }, [store]);

  const snapshot = store.snapshot.value;
  const exit = store.exit.value;
  const server =
    snapshot !== null
      ? `${snapshot.phase.toLowerCase()} ${snapshot.key} ready`
      : exit !== null
        ? `exit ${exit.kind}`
        : (store.createError.value ?? '…');

  return (
    <main>
      <h1>drinkinggame</h1>
      <p>
        Path: <code data-testid="path">{location.pathname}</code>
      </p>
      <p>
        Secure context: <span data-testid="secure">{String(window.isSecureContext)}</span>
      </p>
      <p>
        WebSocket: <span data-testid="ws-status">{store.connectionStatus.value}</span>
      </p>
      <p>
        Server: <span data-testid="server">{server}</span>
      </p>
    </main>
  );
}
