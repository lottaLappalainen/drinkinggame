// One Durable Object per game (CLAUDE.md §1). Phase 1: WebSocket echo only, using the
// Hibernation API (`ctx.acceptWebSocket`) and auto ping/pong from the start.
// Phase 4 replaces the echo with the engine adapter.
import { DurableObject } from 'cloudflare:workers';

export class GameObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object (CLAUDE.md §2 WebSockets).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  override fetch(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    ws.send(typeof message === 'string' ? `echo:${message}` : message);
  }
}
