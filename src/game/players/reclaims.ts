// "That's me" requests (G-44): the parts shared by reclaim, cancel, answer, leave/remove, expiry
// and rebuild. Approval (which turns the requester into the player) lives in handlers/players.ts.
import type {
  ConnId,
  PlayerId,
  PublicReclaim,
  RequestId,
  ServerMessage,
} from '../../shared/protocol';
import { send, toHost, unbind } from '../effects';
import { entriesOf } from '../ids';
import type { GameState, ReclaimState } from '../stateSchema';
import type { Effect } from '../types';

export function toPublicReclaim(requestId: RequestId, request: ReclaimState): PublicReclaim {
  return {
    requestId,
    targetPlayerId: request.targetPlayerId,
    nickname: request.nickname,
    presetId: request.presetId,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

export function pendingReclaims(state: GameState): PublicReclaim[] {
  return entriesOf(state.reclaims)
    .filter(([, request]) => request.status === 'pending')
    .map(([id, request]) => toPublicReclaim(id, request));
}

/** What a (new) host must be told about requests waiting for an answer. */
export function pendingReclaimMessages(state: GameState): ServerMessage[] {
  return pendingReclaims(state).map((request) => ({ type: 'reclaimRequested', request }));
}

/** The open socket of the phone waiting on this request, if it is connected. */
export function requesterConnection(state: GameState, requestId: RequestId): ConnId | undefined {
  return entriesOf(state.connections).find(([, c]) => c.reclaimRequestId === requestId)?.[0];
}

/** Detach a requester socket from its request: it is an anonymous connection again. */
function release(state: GameState, connId: ConnId): Effect {
  const connection = state.connections[connId];
  if (connection) delete connection.reclaimRequestId;
  return unbind(connId);
}

/**
 * Deny a request (host said no, the target came back / left / was removed, it expired).
 * A connected requester hears it now and the request is gone; otherwise it is kept as 'denied'
 * until the requester's phone collects it with `hello` (or it expires).
 */
export function denyReclaim(state: GameState, requestId: RequestId): Effect[] {
  const request = state.reclaims[requestId];
  if (request === undefined) return [];
  const effects: Effect[] = [];
  if (request.status === 'pending') effects.push(toHost({ type: 'reclaimClosed', requestId }));
  const connId = requesterConnection(state, requestId);
  if (connId === undefined) {
    request.status = 'denied';
  } else {
    effects.push(send(connId, { type: 'reclaimResult', approved: false }), release(state, connId));
    delete state.reclaims[requestId];
  }
  return effects;
}

/** The requester cancelled: drop the request entirely. */
export function cancelReclaim(state: GameState, requestId: RequestId, connId: ConnId): Effect[] {
  const request = state.reclaims[requestId];
  const effects: Effect[] = [release(state, connId)];
  if (request?.status === 'pending') effects.push(toHost({ type: 'reclaimClosed', requestId }));
  delete state.reclaims[requestId];
  return effects;
}

/** Leave / remove closes every pending request targeting that player (CLAUDE.md §6). */
export function denyReclaimsFor(state: GameState, playerId: PlayerId): Effect[] {
  return entriesOf(state.reclaims)
    .filter(([, request]) => request.targetPlayerId === playerId && request.status === 'pending')
    .flatMap(([id]) => denyReclaim(state, id));
}

/** Requests past RECLAIM_TTL_MS: closed for the host, the requester hears "no" if connected. */
export function expireReclaims(state: GameState, now: number): Effect[] {
  const effects: Effect[] = [];
  for (const [id, request] of entriesOf(state.reclaims)) {
    if (request.expiresAt > now) continue;
    effects.push(...denyReclaim(state, id));
    delete state.reclaims[id]; // an expired result is never collected any more
  }
  return effects;
}
