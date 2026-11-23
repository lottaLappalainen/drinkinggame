// Placeholder until the real app (Phase 5): proves the whole server path works from a phone —
// create a game over HTTP, open its WebSocket, say hello, receive the lobby. Open it on staging to
// check a real phone (HTTPS). Deliberately unstyled — styling arrives with the design system.
import { useEffect, useState } from 'preact/hooks';
import { PROTOCOL_VERSION } from '../shared/constants';
import type { CreateGameResponse, ServerMessage } from '../shared/protocol';

type Status = 'creating' | 'connecting' | 'open' | 'closed' | 'error';

/** A random token, base64url — crypto.getRandomValues works without a secure context too. */
function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function App() {
  const [status, setStatus] = useState<Status>('creating');
  const [server, setServer] = useState<string>('…');

  useEffect(() => {
    let socket: WebSocket | null = null;
    // An object, so the async code below sees the cleanup set it (a plain let looks constant to lint).
    const life = { cancelled: false };
    const token = newToken();

    void (async () => {
      try {
        const response = await fetch('/api/games', {
          method: 'POST',
          body: JSON.stringify({ nickname: 'Test phone', presetId: 'fox', token }),
        });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const { key } = (await response.json()) as CreateGameResponse;
        if (life.cancelled) return;
        setStatus('connecting');
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(
          `${protocol}//${location.host}/ws/${key}?v=${String(PROTOCOL_VERSION)}`,
        );
        socket.addEventListener('open', () => {
          setStatus('open');
          socket?.send(JSON.stringify({ type: 'hello', token }));
        });
        socket.addEventListener('message', (event: MessageEvent<string>) => {
          const message = JSON.parse(event.data) as ServerMessage;
          if (message.type === 'welcome') setServer(`lobby ${message.snapshot.key} ready`);
          else if (message.type === 'error') setServer(`error ${message.code}`);
        });
        socket.addEventListener('close', () => {
          setStatus('closed');
        });
        socket.addEventListener('error', () => {
          setStatus('error');
        });
      } catch {
        setStatus('error');
      }
    })();

    return () => {
      life.cancelled = true;
      socket?.close();
    };
  }, []);

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
        WebSocket: <span data-testid="ws-status">{status}</span>
      </p>
      <p>
        Server: <span data-testid="server">{server}</span>
      </p>
    </main>
  );
}
