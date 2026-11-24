// "That's me" (G-44): asking for an offline player's spot, cancelling, and the host's answer.
// Shared request logic lives in players/reclaims.ts. Handler conventions: see handlers/players.ts.
import { RECLAIM_TTL_MS } from '../../shared/constants';
import { validateNickname } from '../../shared/nickname';
import type { RequestId } from '../../shared/protocol';
import { bindToRequest, errorTo, send, toHost } from '../effects';
import { newRequestId } from '../ids';
import { attachAsPlayer } from '../players/attach';
import {
  cancelReclaim,
  denyReclaim,
  requesterConnection,
  toPublicReclaim,
} from '../players/reclaims';
import {
  findPlayerByPreviousToken,
  findPlayerByToken,
  findReclaimByToken,
} from '../players/tokens';
import type { GameState, ReclaimState } from '../stateSchema';
import type { Ctx, Effect, EngineMessageOf, PlayerSender, RequesterSender, Sender } from '../types';

/** Only from an ANONYMOUS connection (engine rule). */
export function handleReclaim(
  draft: GameState,
  msg: EngineMessageOf<'reclaim'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const { connId } = sender;
  const target = draft.players[msg.playerId];
  const alreadyRequested = Object.values(draft.reclaims).some(
    (r) => r.targetPlayerId === msg.playerId && r.status === 'pending',
  );
  if (target?.status !== 'active' || target.connId !== null || alreadyRequested)
    return [errorTo(connId, 'RECLAIM_UNAVAILABLE', 'reclaim')];
  // The requester's token must be new to this game (it becomes the player's on approval).
  if (
    findPlayerByToken(draft, msg.tokenHash) ||
    findPlayerByPreviousToken(draft, msg.tokenHash) ||
    findReclaimByToken(draft, msg.tokenHash)
  )
    return [errorTo(connId, 'NOT_ALLOWED', 'reclaim')];
  const name = validateNickname(msg.nickname);
  if (!name.ok) return [errorTo(connId, 'INVALID_NICKNAME', 'reclaim')];

  let requestId: RequestId = newRequestId(ctx.random);
  while (draft.reclaims[requestId] !== undefined) requestId = newRequestId(ctx.random);
  const request: ReclaimState = {
    targetPlayerId: msg.playerId,
    requesterTokenHash: msg.tokenHash,
    nickname: name.nickname,
    presetId: msg.presetId,
    createdAt: ctx.now,
    expiresAt: ctx.now + RECLAIM_TTL_MS,
    status: 'pending',
  };
  draft.reclaims[requestId] = request;
  const connection = draft.connections[connId];
  if (connection) connection.reclaimRequestId = requestId;
  return [
    bindToRequest(connId, requestId),
    send(connId, { type: 'reclaimPending', requestId }),
    toHost({ type: 'reclaimRequested', request: toPublicReclaim(requestId, request) }),
  ];
}

/** Requester cancels (G-44). */
export function handleCancelReclaim(
  draft: GameState,
  _msg: EngineMessageOf<'cancelReclaim'>,
  sender: RequesterSender,
  _ctx: Ctx,
): Effect[] {
  return cancelReclaim(draft, sender.requestId, sender.connId);
}

/**
 * Host answers (G-44). Approval re-checks that the target is still active and offline (else it
 * becomes a denial), then gives the player the requester's token hash — the old token stops
 * working. A connected requester continues as the player right away; otherwise they collect the
 * result with `hello` later.
 */
export function handleAnswerReclaim(
  draft: GameState,
  msg: EngineMessageOf<'answerReclaim'>,
  _sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  const request = draft.reclaims[msg.requestId];
  // Already cancelled / expired / answered: the host's tap is simply late.
  if (request?.status !== 'pending') return [];
  const target = draft.players[request.targetPlayerId];
  if (!msg.approve || target?.status !== 'active' || target.connId !== null)
    return denyReclaim(draft, msg.requestId);

  // The old phone's token stops resuming the player, but is remembered so that phone hears
  // RECLAIMED ("continued on another phone") rather than "Game not found".
  target.previousTokenHashes.push(target.tokenHash);
  target.tokenHash = request.requesterTokenHash;
  request.status = 'approved';
  const effects: Effect[] = [toHost({ type: 'reclaimClosed', requestId: msg.requestId })];
  const connId = requesterConnection(draft, msg.requestId);
  if (connId !== undefined) {
    effects.push(send(connId, { type: 'reclaimResult', approved: true }));
    delete draft.reclaims[msg.requestId];
    effects.push(...attachAsPlayer(draft, request.targetPlayerId, connId, ctx.now));
  }
  return effects;
}
