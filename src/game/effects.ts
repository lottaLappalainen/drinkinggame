// Small constructors for effects, used by the engine and every handler (so handlers don't have to
// import engine.ts, which imports them).
import type {
  ClientMessageType,
  ConnId,
  ErrorCode,
  PlayerId,
  RequestId,
  ServerMessage,
} from '../shared/protocol';
import type { Effect, WsCloseCode } from './types';

export function send(connId: ConnId, message: ServerMessage): Effect {
  return { kind: 'send', connId, message };
}

/** To every online active player, optionally except some. */
export function broadcast(message: ServerMessage, except?: readonly PlayerId[]): Effect {
  return except === undefined || except.length === 0
    ? { kind: 'broadcast', message }
    : { kind: 'broadcast', message, except };
}

export function toHost(message: ServerMessage): Effect {
  return { kind: 'sendToHost', message };
}

/** An error reply naming the request it answers (`for`), so the phone knows what failed. */
export function errorTo(
  connId: ConnId,
  code: Exclude<ErrorCode, 'NAME_TAKEN'>,
  forType?: ClientMessageType,
): Effect {
  return send(
    connId,
    forType === undefined ? { type: 'error', code } : { type: 'error', code, for: forType },
  );
}

export function close(connId: ConnId, code: WsCloseCode, reason: string): Effect {
  return { kind: 'close', connId, code, reason };
}

// Tell the DO who a socket belongs to now (it stores this in the socket's attachment).
export function bindToPlayer(connId: ConnId, playerId: PlayerId): Effect {
  return { kind: 'bindConnection', connId, playerId };
}

export function bindToRequest(connId: ConnId, reclaimRequestId: RequestId): Effect {
  return { kind: 'bindConnection', connId, reclaimRequestId };
}

/** The socket is anonymous again (left the game, reclaim result delivered, …). */
export function unbind(connId: ConnId): Effect {
  return { kind: 'bindConnection', connId };
}
