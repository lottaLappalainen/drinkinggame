// Phase 1 placeholder: proves the page, the WebSocket and the Durable Object are wired together.
// Replaced by the real app (screens, store, connection manager) in Phase 5.
// Deliberately unstyled — styling only arrives with the design system (CLAUDE.md §7).
import { useEffect, useState } from 'preact/hooks';

type Status = 'connecting' | 'open' | 'closed' | 'error';

const ECHO_KEY = 'TEST1';

export function App() {
  const [status, setStatus] = useState<Status>('connecting');
  const [reply, setReply] = useState<string | null>(null);

  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws/${ECHO_KEY}`);
    socket.addEventListener('open', () => {
      setStatus('open');
      socket.send('hello');
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      setReply(event.data);
    });
    socket.addEventListener('close', () => setStatus('closed'));
    socket.addEventListener('error', () => setStatus('error'));
    return () => socket.close();
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
        Echo: <span data-testid="echo">{reply ?? '…'}</span>
      </p>
    </main>
  );
}
