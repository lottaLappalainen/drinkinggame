// Worker entry point: routes API and WebSocket requests. Everything else is served from the
// static assets (see `assets` in wrangler.jsonc), so this only runs for /api/* and /ws/*.
import { GameObject } from './GameObject';

export { GameObject };

// Phase 1: any 5-character uppercase/digit key reaches a DO. Phase 4 adds the real key
// alphabet, the "unknown key → 404 without storage writes" rule and the claim flow.
const WS_PATH = /^\/ws\/([A-Z0-9]{5})$/;

export default {
  fetch(request, env): Response | Promise<Response> {
    const url = new URL(request.url);

    const wsMatch = WS_PATH.exec(url.pathname);
    if (wsMatch?.[1] !== undefined) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      const stub = env.GAME.get(env.GAME.idFromName(wsMatch[1]));
      return stub.fetch(request);
    }

    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
