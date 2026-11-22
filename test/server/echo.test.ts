// Phase 1 sample: the Worker routes a WebSocket upgrade to the Durable Object, which echoes.
// Runs inside workerd. Replaced by real integration tests in Phase 4.
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

async function openSocket(path: string): Promise<WebSocket> {
  const response = await exports.default.fetch(`https://example.com${path}`, {
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('No WebSocket in the upgrade response');
  socket.accept();
  return socket;
}

describe('WebSocket echo', () => {
  it('echoes a text message through the Durable Object', async () => {
    const socket = await openSocket('/ws/TEST1');
    const reply = new Promise<string>((resolve) => {
      socket.addEventListener('message', (event) => resolve(String(event.data)));
    });
    socket.send('hello');
    expect(await reply).toBe('echo:hello');
    socket.close();
  });

  it('rejects a non-WebSocket request to /ws/', async () => {
    const response = await exports.default.fetch('https://example.com/ws/TEST1');
    expect(response.status).toBe(426);
  });

  it('answers unknown API routes with 404', async () => {
    const response = await exports.default.fetch('https://example.com/api/nope');
    expect(response.status).toBe(404);
  });
});
