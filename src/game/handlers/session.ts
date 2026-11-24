// Creating a game and `hello`: resume, collect a "That's me" result, or join as a new player
// (CLAUDE.md §5 "hello resolution"). Handler conventions: see handlers/players.ts.
import { MAX_PLAYERS } from '../../shared/constants';
import { validateNickname, nameKey } from '../../shared/nickname';
import type { ErrorCode } from '../../shared/protocol';
import { bindToPlayer, bindToRequest, broadcast, errorTo, send, unbind } from '../effects';
import { newGameId, newPlayerId } from '../ids';
import { attachAsPlayer, welcome } from '../players/attach';
import { fillVacantHost } from '../players/host';
import { activePlayers, setOnline } from '../players/presence';
import { replaceRequesterSockets } from '../players/reclaims';
import {
  findPlayerByPreviousToken,
  findPlayerByToken,
  findReclaimByToken,
} from '../players/tokens';
import { toPublicPlayer } from '../players/view';
import { createGame, createPlayer, type GameState, type PlayerState } from '../stateSchema';
import type { ClaimEvent, ClaimResult, Ctx, Effect, EngineMessageOf, Sender } from '../types';

// ── Creating a game ─────────────────────────────────────────────────────────

/** Create a game from a claim (G-10): a lobby with the creator as host (offline until connected). */
export function claimGame(event: ClaimEvent, ctx: Ctx): ClaimResult {
  const name = validateNickname(event.nickname);
  if (!name.ok) return { ok: false, error: 'INVALID_NICKNAME' };
  const playerId = newPlayerId(ctx.random);
  const state = createGame({
    key: event.key,
    gameId: newGameId(ctx.random),
    hostId: playerId,
    host: {
      nickname: name.nickname,
      nameKey: nameKey(name.nickname),
      presetId: event.presetId,
      tokenHash: event.tokenHash,
      now: ctx.now,
    },
  });
  return { ok: true, state, playerId };
}

// ── hello: resume, collect a reclaim result, or join (CLAUDE.md §5) ─────────

export function handleHello(
  draft: GameState,
  msg: EngineMessageOf<'hello'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const { connId } = sender;
  const fail = (code: Exclude<ErrorCode, 'NAME_TAKEN'>) => [errorTo(connId, code, 'hello')];
  // (The protocol version was checked when the socket opened — it comes in the WebSocket URL.)
  const connection = draft.connections[connId];

  // The saved game failed its version check: everyone just hears that it was updated.
  if (draft.phase === 'ENDED' && draft.endReason === 'updated') {
    return [send(connId, { type: 'gameEnded', reason: 'updated', summary: null })];
  }
  // A token from an earlier game under the same key never turns into a player here.
  if (msg.gameId !== undefined && msg.gameId !== draft.gameId) return fail('NOT_FOUND');

  const owner = findPlayerByToken(draft, msg.tokenHash);
  if (owner) {
    const [playerId, player] = owner;
    if (player.status === 'left') return fail('LEFT');
    if (player.status === 'removed') return fail('REMOVED');
    if (sender.playerId !== undefined && sender.playerId !== playerId) return fail('NOT_ALLOWED');
    const effects: Effect[] = [];
    // An approved "That's me" being collected: approval gave the player this phone's token (G-44).
    const collected = findReclaimByToken(draft, msg.tokenHash);
    if (collected?.[1].status === 'approved') {
      effects.push(send(connId, { type: 'reclaimResult', approved: true }));
      delete draft.reclaims[collected[0]];
    }
    effects.push(...attachAsPlayer(draft, playerId, connId, ctx.now));
    return effects;
  }

  // This phone's player continued on another phone through an approved "That's me" (G-44).
  if (findPlayerByPreviousToken(draft, msg.tokenHash)) return fail('RECLAIMED');

  // A "That's me" requester whose phone reconnected (screen lock, restart).
  const request = findReclaimByToken(draft, msg.tokenHash);
  if (request) {
    const [requestId, state] = request;
    if (state.status === 'pending') {
      // One socket waits on a request, like one socket per player (G-18): otherwise the phone's
      // older socket (iOS keeps dead ones open) could get the answer and this one never would.
      const replaced = replaceRequesterSockets(draft, requestId, connId);
      if (connection) connection.reclaimRequestId = requestId;
      return [
        ...replaced,
        bindToRequest(connId, requestId),
        send(connId, { type: 'reclaimPending', requestId }),
      ];
    }
    // Denied while the phone was away. (Approved can't get here: the token now owns the player.)
    delete draft.reclaims[requestId];
    const effects: Effect[] = [send(connId, { type: 'reclaimResult', approved: false })];
    if (connection?.reclaimRequestId === requestId) {
      delete connection.reclaimRequestId; // this very socket was still waiting on it
      effects.push(unbind(connId));
    }
    return effects;
  }

  return joinAsNewPlayer(draft, msg, sender, ctx);
}

/** Unknown token: join as a new player — only on an explicit Join (with a nickname). */
function joinAsNewPlayer(
  draft: GameState,
  msg: EngineMessageOf<'hello'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const { connId } = sender;
  const fail = (code: Exclude<ErrorCode, 'NAME_TAKEN'>) => [errorTo(connId, code, 'hello')];

  // No join profile = an automatic reconnect with a token this game doesn't know (G-12).
  const { join } = msg;
  if (join === undefined) return fail('NOT_FOUND');
  // A finished game takes no new players; only known tokens still see Game Over (G-12, G-48).
  if (draft.phase === 'ENDED') return fail('NOT_FOUND');
  if (sender.playerId !== undefined || sender.reclaimRequestId !== undefined)
    return fail('NOT_ALLOWED');

  const name = validateNickname(join.nickname);
  if (!name.ok) return fail('INVALID_NICKNAME');
  const key = nameKey(name.nickname);
  const holder = activePlayers(draft).find(([, player]) => player.nameKey === key);
  if (holder) {
    const [holderId, holderState] = holder;
    // Owner offline → the joiner may say "That's me" (G-14, G-44).
    return [
      send(
        connId,
        holderState.connId === null
          ? { type: 'error', code: 'NAME_TAKEN', for: 'hello', reclaimPlayerId: holderId }
          : { type: 'error', code: 'NAME_TAKEN', for: 'hello' },
      ),
    ];
  }
  if (activePlayers(draft).length >= MAX_PLAYERS) return fail('GAME_FULL'); // G-13

  let playerId = newPlayerId(ctx.random);
  while (draft.players[playerId] !== undefined) playerId = newPlayerId(ctx.random);

  const player: PlayerState = {
    ...createPlayer({
      nickname: name.nickname,
      nameKey: key,
      presetId: join.presetId,
      tokenHash: msg.tokenHash,
      now: ctx.now,
      // Late joiners take part from the next question (G-15, G-19).
      activeFromRound: draft.phase === 'LOBBY' ? 1 : (draft.round?.roundId ?? 0) + 1,
    }),
    // A late joiner starts level with the least-shown player, so fair selection (G-35) doesn't
    // pick them for every question until they "catch up".
    timesShown: leastShown(draft), // computed before this player is added
  };
  draft.players[playerId] = player;
  setOnline(draft, playerId, connId, ctx.now); // a join is announced as playerJoined instead
  const hostEffects = fillVacantHost(draft, playerId);

  // Welcome first (built from the state after this step), then the deltas (CLAUDE.md §5).
  return [
    bindToPlayer(connId, playerId),
    welcome(draft, playerId, connId, ctx.now),
    broadcast({ type: 'playerJoined', player: toPublicPlayer(draft, playerId, player) }, [
      playerId,
    ]),
    ...hostEffects,
  ];
}

function leastShown(draft: GameState): number {
  const shown = activePlayers(draft).map(([, player]) => player.timesShown);
  return shown.length === 0 ? 0 : Math.min(...shown);
}
