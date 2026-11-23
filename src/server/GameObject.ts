// One Durable Object per game (CLAUDE.md §1) — the THIN ADAPTER between Cloudflare and the pure
// engine in src/game: everything that happens becomes an engine event; the engine decides; this
// class saves the state (only if it changed), executes the returned effects in order and sets the
// alarm. No game rules live here.
//
// Every event is handled synchronously from start to finish (CLAUDE.md §4): read state → hash the
// token (node:crypto, sync) → applyEvent → write with the sync KV API → effects → alarm. Nothing is
// awaited in between, so no other event can interleave mid-event. Alarm calls are not awaited
// either: the runtime's output gate holds outgoing messages until storage writes are confirmed.
import { DurableObject } from 'cloudflare:workers';
import { nextDeadline } from '../game/deadlines';
import { applyClaim, applyEvent } from '../game/engine';
import { entriesOf } from '../game/ids';
import type { GameState } from '../game/stateSchema';
import type { Ctx, Effect, EngineEvent, RebuildSocket } from '../game/types';
import type { PresetId } from '../shared/avatars';
import {
  MAX_ANONYMOUS_CONNECTIONS,
  PING_MESSAGE,
  PONG_MESSAGE,
  WS_CLOSE,
} from '../shared/constants';
import type { ConnId, ErrorCode, GameId, GameKey, ServerMessage } from '../shared/protocol';
import { bindAttachment, newAttachment, readAttachment } from './core/attachment';
import { hashToken, parseIncoming } from './core/incoming';
import { isStale, nextLivenessCheckAt } from './core/liveness';
import { STATE_KEY, loadState, saveState } from './core/persistence';
import { newConnId, random } from './core/random';

export type ClaimInput = {
  readonly key: GameKey;
  readonly nickname: string;
  readonly presetId: PresetId;
  /** The host phone's raw token — hashed here, never stored. */
  readonly token: string;
};

export type ClaimOutcome =
  | { readonly ok: true; readonly gameId: GameId }
  | { readonly ok: false; readonly error: 'TAKEN' | ErrorCode };

export class GameObject extends DurableObject<Env> {
  /**
   * Game time for the engine. A seam for tests, which move it forward instead of waiting 60 s for
   * a host handover; always `Date.now()` in production. (The liveness check deliberately uses the
   * real clock — it is about real network silence.)
   */
  clock: () => number = () => Date.now();

  private loaded = false;
  /** The working copy; null = no game under this key (never claimed, or deleted). */
  private game: GameState | null = null;
  /** The alarm we last set (null = none); undefined = unknown, e.g. after a wake. */
  private alarmAt: number | null | undefined = undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object (CLAUDE.md §2 WebSockets).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING_MESSAGE, PONG_MESSAGE));
  }

  // ── Entry points ──────────────────────────────────────────────────────────

  /**
   * Create the game under this key (RPC from the Worker). Atomic: synchronous from the "is there a
   * game?" check to the write, so two claims for the same key can't both succeed.
   */
  claim(input: ClaimInput): ClaimOutcome {
    this.ensureLoaded();
    if (this.game !== null) return { ok: false, error: 'TAKEN' };
    const result = applyClaim(
      {
        key: input.key,
        nickname: input.nickname,
        presetId: input.presetId,
        tokenHash: hashToken(input.token),
      },
      this.engineCtx(),
    );
    if (!result.ok) return { ok: false, error: result.error };
    this.game = result.state;
    saveState(this.ctx.storage.kv, result.state);
    this.syncAlarm();
    return { ok: true, gameId: result.state.gameId };
  }

  /** WebSocket upgrade for `/ws/<KEY>?v=N` (the Worker checked the key's format). */
  override fetch(request: Request): Response {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426 });
    }
    this.ensureLoaded();
    const protocolVersion = parseVersion(new URL(request.url).searchParams.get('v'));
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const connId = newConnId();
    // Tagged with its connId, so a send finds it without scanning every socket's attachment.
    this.ctx.acceptWebSocket(server, [connId]);
    server.serializeAttachment(newAttachment(connId, protocolVersion, Date.now()));

    if (this.game === null) {
      // Accept, tell, close — never an HTTP 404 before accepting: browsers hide a failed upgrade's
      // status, so the phone couldn't tell "no such game" from a network drop. Nothing is written.
      this.sendOn(server, { type: 'error', code: 'NOT_FOUND' });
      closeSocket(server, WS_CLOSE.NOT_FOUND, 'game not found');
    } else if (this.anonymousConnections() >= MAX_ANONYMOUS_CONNECTIONS) {
      this.sendOn(server, { type: 'error', code: 'NOT_ALLOWED' });
      closeSocket(server, WS_CLOSE.TOO_MANY_CONNECTIONS, 'too many connections');
    } else {
      // The engine checks the protocol version and closes a mismatched socket itself.
      this.handle({ kind: 'connectionOpened', connId, protocolVersion });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.ensureLoaded();
    const attachment = readAttachment(ws);
    if (attachment === null) {
      closeSocket(ws, WS_CLOSE.STALE, 'unknown socket');
      return;
    }
    if (this.game === null) {
      // The game was deleted while this socket was still open (it is being closed).
      this.sendOn(ws, { type: 'error', code: 'NOT_FOUND' });
      closeSocket(ws, WS_CLOSE.NOT_FOUND, 'game not found');
      return;
    }
    const incoming = parseIncoming(message);
    if (!incoming.ok) {
      this.sendOn(ws, incoming.reply);
      return;
    }
    this.handle({ kind: 'message', from: attachment.connId, msg: incoming.msg });
  }

  // Both can fire for the same socket; the second is a no-op (the engine ignores unknown sockets).
  override webSocketClose(ws: WebSocket): void {
    this.socketGone(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.socketGone(ws);
  }

  override alarm(): void {
    this.ensureLoaded();
    this.alarmAt = undefined; // it fired; the next syncAlarm sets a fresh one
    if (this.game === null) return;
    this.checkLiveness();
    this.handle({ kind: 'deadline' });
    this.syncAlarm();
  }

  // ── The event path ────────────────────────────────────────────────────────

  /** Load the saved game once per instance, then reconcile it with the sockets that exist. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const loaded = loadState(this.ctx.storage.kv, this.clock());
    if (loaded.kind === 'none') return;
    this.game = loaded.state;
    if (loaded.kind === 'updated') saveState(this.ctx.storage.kv, loaded.state);

    // ONE rebuild event listing every live socket — never one connection event per socket, which
    // would broadcast on every hibernation wake. Its effects are executed like any others.
    this.handle({ kind: 'rebuild', sockets: this.liveSockets() });

    if (loaded.kind === 'updated') {
      // Sockets that survived the code update never send another hello: tell them directly.
      for (const ws of this.ctx.getWebSockets())
        this.sendOn(ws, { type: 'gameEnded', reason: 'updated', summary: null });
    }
  }

  /** applyEvent → save if changed → effects in order → alarm. */
  private handle(event: EngineEvent): void {
    const game = this.game;
    if (game === null) return;
    let result;
    try {
      result = applyEvent(game, event, this.engineCtx());
    } catch (error) {
      // An engine bug must never throw out of a socket handler; the state stays as it was.
      logError('engine', event.kind, error);
      return;
    }
    if (result.changed) {
      this.game = result.state;
      saveState(this.ctx.storage.kv, result.state);
    }
    this.execute(result.effects, result.state);
    this.syncAlarm();
  }

  /**
   * Run the effects in list order ("welcome first", CLAUDE.md §5). Each one is isolated: sending on
   * a socket that just died throws, and one dead phone must not stop the remaining sends after the
   * state was already saved.
   */
  private execute(effects: readonly Effect[], state: GameState): void {
    for (const effect of effects) {
      try {
        switch (effect.kind) {
          case 'send':
            this.sendTo(effect.connId, JSON.stringify(effect.message));
            break;
          case 'broadcast': {
            // Each player's CURRENT socket only — a replaced socket still carries the playerId
            // in its attachment until it closes (G-18) and must not get game updates.
            const text = JSON.stringify(effect.message);
            for (const [playerId, player] of entriesOf(state.players)) {
              if (player.status !== 'active' || player.connId === null) continue;
              if (effect.except?.includes(playerId)) continue;
              this.sendTo(player.connId, text);
            }
            break;
          }
          case 'sendToHost': {
            const host = state.hostId === null ? undefined : state.players[state.hostId];
            if (host?.connId != null) this.sendTo(host.connId, JSON.stringify(effect.message));
            break;
          }
          case 'close': {
            const ws = this.socket(effect.connId);
            if (ws) closeSocket(ws, effect.code, effect.reason);
            break;
          }
          case 'bindConnection': {
            const ws = this.socket(effect.connId);
            if (ws) bindAttachment(ws, effect);
            break;
          }
          case 'deleteGame':
            this.deleteGame();
            return; // nothing of this game remains to act on
          default:
            assertNever(effect);
        }
      } catch (error) {
        logError('effect', effect.kind, error);
      }
    }
  }

  /**
   * Retention or idle cleanup is due (G-48): close every socket, delete everything, and forget the
   * game in memory too — an event still queued must see "no game" (a late message must never
   * recreate state).
   */
  private deleteGame(): void {
    for (const ws of this.ctx.getWebSockets())
      closeSocket(ws, WS_CLOSE.GAME_DELETED, 'game deleted');
    this.ctx.storage.kv.delete(STATE_KEY);
    void this.ctx.storage.deleteAll(); // photos too (4B)
    void this.ctx.storage.deleteAlarm();
    this.game = null;
    this.alarmAt = null;
  }

  /** Alarm = min(next game deadline, next liveness check while any socket is open). */
  private syncAlarm(): void {
    const game = this.game;
    const deadline = game === null ? null : nextDeadline(game);
    const liveness =
      game !== null && this.ctx.getWebSockets().length > 0 ? nextLivenessCheckAt(Date.now()) : null;
    const candidates = [deadline, liveness].filter((t): t is number => t !== null);
    const at = candidates.length === 0 ? null : Math.min(...candidates);
    if (at === this.alarmAt) return; // setting the same alarm again would be a wasted write
    this.alarmAt = at;
    if (at === null) void this.ctx.storage.deleteAlarm();
    else void this.ctx.storage.setAlarm(at);
  }

  /** Close sockets that have been silent too long; each becomes a normal connectionClosed event. */
  private checkLiveness(): void {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = readAttachment(ws);
      if (attachment === null) continue;
      const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null;
      if (!isStale(lastPing, attachment.openedAt, now)) continue;
      closeSocket(ws, WS_CLOSE.STALE, 'no ping');
      this.handle({ kind: 'connectionClosed', connId: attachment.connId });
    }
  }

  private socketGone(ws: WebSocket): void {
    this.ensureLoaded();
    closeSocket(ws, 1000, 'closed'); // complete the close handshake if the runtime hasn't
    const attachment = readAttachment(ws);
    if (attachment === null || this.game === null) return;
    this.handle({ kind: 'connectionClosed', connId: attachment.connId });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private engineCtx(): Ctx {
    return { now: this.clock(), random };
  }

  /** Every open socket with what its attachment says (for the rebuild event). */
  private liveSockets(): RebuildSocket[] {
    const sockets: RebuildSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = readAttachment(ws);
      if (attachment === null) {
        closeSocket(ws, WS_CLOSE.STALE, 'unknown socket');
        continue;
      }
      sockets.push({
        connId: attachment.connId,
        protocolVersion: attachment.protocolVersion,
        ...(attachment.playerId !== undefined && { playerId: attachment.playerId }),
        ...(attachment.reclaimRequestId !== undefined && {
          reclaimRequestId: attachment.reclaimRequestId,
        }),
      });
    }
    return sockets;
  }

  private anonymousConnections(): number {
    if (this.game === null) return 0;
    return Object.values(this.game.connections).filter(
      (c) => c.playerId === undefined && c.reclaimRequestId === undefined,
    ).length;
  }

  private socket(connId: ConnId): WebSocket | undefined {
    return this.ctx.getWebSockets(connId)[0];
  }

  private sendTo(connId: ConnId, text: string): void {
    const ws = this.socket(connId);
    if (ws === undefined) return;
    try {
      ws.send(text);
    } catch (error) {
      logError('send', 'socket', error); // it just died; its close event follows
    }
  }

  private sendOn(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logError('send', 'socket', error);
    }
  }
}

/** `?v=N` from the WebSocket URL; missing or unreadable → 0, i.e. "outdated" (reload). */
function parseVersion(value: string | null): number {
  return value !== null && /^\d{1,6}$/.test(value) ? Number(value) : 0;
}

function closeSocket(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closed or closing
  }
}

/** Errors only, and never tokens, nicknames or photos (CLAUDE.md §2 Logging). */
function logError(where: string, what: string, error: unknown): void {
  console.error(
    `[game] ${where} failed (${what}):`,
    error instanceof Error ? error.message : 'unknown',
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled effect: ${JSON.stringify(value)}`);
}
