// Sockets opening, closing, and the rebuild after a load (CLAUDE.md §3/§4): who is online is
// always derived from the sockets that exist. Handler conventions: see handlers/players.ts.
import { PROTOCOL_VERSION, WS_CLOSE } from '../../shared/constants';
import type { ConnId } from '../../shared/protocol';
import { close, errorTo, send, unbind } from '../effects';
import { entriesOf } from '../ids';
import { attachAsPlayer } from '../players/attach';
import {
  cancelHandoverIfHostOnline,
  changeHost,
  pickNewHost,
  startHandoverTimer,
} from '../players/host';
import { refreshIdle, setOffline, setOnline } from '../players/presence';
import { denyReclaim } from '../players/reclaims';
import type { ConnectionState, GameState } from '../stateSchema';
import type { Ctx, Effect, EngineEvent } from '../types';

/**
 * Socket opened: register it as anonymous until it identifies itself with hello / reclaim.
 * The protocol version comes from the WebSocket URL (`/ws/KEY?v=N`, CLAUDE.md §4) — the ONE place
 * it is checked for a new socket. A mismatched phone is told why and closed, never registered.
 */
export function onConnectionOpened(
  draft: GameState,
  event: Extract<EngineEvent, { kind: 'connectionOpened' }>,
  _ctx: Ctx,
): Effect[] {
  const mismatch = protocolMismatch(event.protocolVersion);
  if (mismatch !== null) {
    return [
      errorTo(event.connId, mismatch),
      close(event.connId, WS_CLOSE.PROTOCOL_MISMATCH, mismatch),
    ];
  }
  draft.connections[event.connId] ??= { protocolVersion: event.protocolVersion };
  return [];
}

/**
 * Socket closed: drop it; the player goes offline ONLY if it was their current socket (a replaced
 * older socket closing must not, G-18). A requester's pending request stays (collected later).
 */
export function onConnectionClosed(
  draft: GameState,
  event: Extract<EngineEvent, { kind: 'connectionClosed' }>,
  ctx: Ctx,
): Effect[] {
  const connection = draft.connections[event.connId];
  if (connection === undefined) return [];
  delete draft.connections[event.connId];
  const playerId = connection.playerId;
  if (playerId === undefined || draft.players[playerId]?.connId !== event.connId) return [];
  const effects = setOffline(draft, playerId, ctx.now);
  if (playerId === draft.hostId) startHandoverTimer(draft, ctx.now);
  return effects;
}

/**
 * Reconcile the state with the sockets that exist after a load (CLAUDE.md §3/§4). Effects ONLY
 * for real changes: a plain hibernation wake where everything matches returns [].
 */
export function onRebuild(
  draft: GameState,
  event: Extract<EngineEvent, { kind: 'rebuild' }>,
  ctx: Ctx,
): Effect[] {
  const effects: Effect[] = [];
  const connections: Record<ConnId, ConnectionState> = {};

  for (const socket of event.sockets) {
    // A phone on a different protocol than the code now running (deploy mid-game, §4).
    const mismatch = protocolMismatch(socket.protocolVersion);
    if (mismatch !== null) {
      effects.push(
        errorTo(socket.connId, mismatch),
        close(socket.connId, WS_CLOSE.PROTOCOL_MISMATCH, mismatch),
      );
      continue;
    }
    const entry: ConnectionState = { protocolVersion: socket.protocolVersion };
    if (socket.playerId !== undefined && draft.players[socket.playerId]?.status === 'active') {
      entry.playerId = socket.playerId;
    } else if (
      socket.reclaimRequestId !== undefined &&
      draft.reclaims[socket.reclaimRequestId] !== undefined
    ) {
      entry.reclaimRequestId = socket.reclaimRequestId;
    } else if (socket.playerId !== undefined || socket.reclaimRequestId !== undefined) {
      effects.push(unbind(socket.connId)); // its identity no longer exists
    }
    connections[socket.connId] = entry;
  }
  draft.connections = connections;

  for (const [playerId, player] of entriesOf(draft.players)) {
    const current = player.connId;
    if (current !== null && connections[current]?.playerId === playerId) continue; // unchanged
    const other = entriesOf(connections).find(([, c]) => c.playerId === playerId)?.[0];
    if (player.status !== 'active' || other === undefined) {
      effects.push(...setOffline(draft, playerId, ctx.now)); // its socket is gone
      if (playerId === draft.hostId) startHandoverTimer(draft, ctx.now);
    } else if (current === null) {
      effects.push(...setOnline(draft, playerId, other, ctx.now));
    } else {
      player.connId = other; // still online, through another of its sockets
    }
  }

  // Requesters who are connected while their result is already decided hear it now.
  for (const [connId, connection] of entriesOf(connections)) {
    const requestId = connection.reclaimRequestId;
    const request = requestId === undefined ? undefined : draft.reclaims[requestId];
    if (requestId === undefined || request === undefined || request.status === 'pending') continue;
    if (request.status === 'denied') {
      effects.push(...denyReclaim(draft, requestId));
    } else {
      const target = entriesOf(draft.players).find(
        ([, p]) => p.tokenHash === request.requesterTokenHash,
      )?.[0];
      delete draft.reclaims[requestId];
      effects.push(send(connId, { type: 'reclaimResult', approved: true }));
      if (target !== undefined) effects.push(...attachAsPlayer(draft, target, connId, ctx.now));
    }
  }

  // A host found online after all keeps the role (as on any reconnect, players/attach.ts).
  cancelHandoverIfHostOnline(draft);
  if (draft.hostId === null) effects.push(...changeHost(draft, pickNewHost(draft)));
  refreshIdle(draft, ctx.now);
  return effects;
}

/** Older phone → reload; newer phone (this object still runs old code) → retry (CLAUDE.md §4). */
function protocolMismatch(version: number): 'OUTDATED_CLIENT' | 'SERVER_UPDATING' | null {
  if (version < PROTOCOL_VERSION) return 'OUTDATED_CLIENT';
  if (version > PROTOCOL_VERSION) return 'SERVER_UPDATING';
  return null;
}
