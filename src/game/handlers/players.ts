// Player-side game logic (Phase 3A): joining, resuming, profiles, leaving, the host role,
// "That's me" requests, presence and the per-viewer snapshot.
//
// Conventions for every handler here:
// - MUTATE `draft` (a private deep copy owned by the engine); return the effects.
// - The engine has already checked: sender identity, host-only, phase, stale roundId.
// - Never decide round end / ready counter / pause here — that is rounds.onPlayersChanged,
//   which the engine calls automatically after any change to who is online or active.
import { validateNickname, nameKey } from '../../shared/nickname';
import {
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  RECLAIM_TTL_MS,
  REMOVE_OFFLINE_MIN_MS,
  WS_CLOSE,
} from '../../shared/constants';
import type { ConnId, ErrorCode, PlayerId, RequestId, Settings } from '../../shared/protocol';
import { normalizeCategories } from '../../shared/questionCategories';
import { idleCleanupAt } from '../deadlines';
import {
  bindToPlayer,
  bindToRequest,
  broadcast,
  close,
  errorTo,
  send,
  toHost,
  unbind,
} from '../effects';
import { entriesOf, newGameId, newPlayerId, newRequestId } from '../ids';
import {
  cancelHandoverIfHostOnline,
  changeHost,
  fillVacantHost,
  pickNewHost,
  runHandover,
  startHandoverTimer,
} from '../players/host';
import { activePlayers, refreshIdle, setOffline, setOnline } from '../players/presence';
import {
  cancelReclaim,
  denyReclaim,
  denyReclaimsFor,
  expireReclaims,
  requesterConnection,
  toPublicReclaim,
} from '../players/reclaims';
import { buildSnapshot, toPublicPlayer } from '../players/view';
import {
  createGame,
  createPlayer,
  type ConnectionState,
  type GameState,
  type PlayerState,
  type ReclaimState,
} from '../stateSchema';
import type {
  ClaimEvent,
  ClaimResult,
  Ctx,
  Effect,
  EngineEvent,
  EngineMessageOf,
  Sender,
} from '../types';

export { buildSnapshot } from '../players/view';

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
      if (connection) connection.reclaimRequestId = requestId;
      return [
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

// ── Profile & settings (lobby only — the engine checks the phase) ────────────

/** Own nickname / preset, LOBBY only (G-1, G-5, G-6). photoVersion is never set here. */
export function handleUpdateProfile(
  draft: GameState,
  msg: EngineMessageOf<'updateProfile'>,
  sender: Sender,
  _ctx: Ctx,
): Effect[] {
  const [playerId, player] = senderPlayer(draft, sender);
  const before = JSON.stringify(player);

  if (msg.nickname !== undefined) {
    const name = validateNickname(msg.nickname);
    if (!name.ok) return [errorTo(sender.connId, 'INVALID_NICKNAME', 'updateProfile')];
    const key = nameKey(name.nickname);
    const taken = activePlayers(draft).some(([id, p]) => id !== playerId && p.nameKey === key);
    if (taken)
      return [send(sender.connId, { type: 'error', code: 'NAME_TAKEN', for: 'updateProfile' })];
    player.nickname = name.nickname;
    player.nameKey = key;
  }
  if (msg.presetId !== undefined) player.avatar.presetId = msg.presetId;

  if (JSON.stringify(player) === before) return [];
  return [
    broadcast({
      type: 'playerUpdated',
      playerId,
      nickname: player.nickname,
      avatar: { ...player.avatar },
    }),
  ];
}

/**
 * Host, LOBBY only: game length and categories (G-20, G-22). Takes the whole settings object.
 * A selection that can't fill the length is accepted here (the host may be mid-way through
 * changing both); `start` refuses it (G-23).
 */
export function handleSetSettings(
  draft: GameState,
  msg: EngineMessageOf<'setSettings'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  const next: Settings = {
    gameLength: msg.settings.gameLength,
    categories: normalizeCategories(msg.settings.categories),
  };
  if (JSON.stringify(next) === JSON.stringify(draft.settings)) return [];
  draft.settings = next;
  return [
    broadcast({ type: 'settingsChanged', settings: { ...next, categories: [...next.categories] } }),
  ];
}

// ── Leaving & removal (G-41, G-43) ──────────────────────────────────────────

/** Leave for good (G-41). */
export function handleLeave(
  draft: GameState,
  _msg: EngineMessageOf<'leave'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const [playerId] = senderPlayer(draft, sender);
  return retirePlayer(draft, playerId, 'left', ctx.now);
}

/** Host removes a player offline ≥ REMOVE_OFFLINE_MIN_MS (G-43); same effects as leaving. */
export function handleRemovePlayer(
  draft: GameState,
  msg: EngineMessageOf<'removePlayer'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const target = draft.players[msg.playerId];
  const offlineLongEnough =
    target?.status === 'active' &&
    target.connId === null &&
    target.offlineSince !== null &&
    ctx.now - target.offlineSince >= REMOVE_OFFLINE_MIN_MS;
  if (!offlineLongEnough) return [errorTo(sender.connId, 'NOT_ALLOWED', 'removePlayer')];
  return retirePlayer(draft, msg.playerId, 'removed', ctx.now);
}

/**
 * Leave / remove: the player stays on record (their token then gets LEFT / REMOVED), no longer
 * counts toward MAX_PLAYERS, frees their name, can't be ranked in later rounds, and any pending
 * "That's me" for them is closed. A leaving host hands over at once (G-41).
 */
function retirePlayer(
  draft: GameState,
  playerId: PlayerId,
  reason: 'left' | 'removed',
  now: number,
): Effect[] {
  const player = draft.players[playerId];
  if (player === undefined) return [];
  const socket = player.connId;
  player.status = reason;
  const effects: Effect[] = [...setOffline(draft, playerId, now)];
  if (socket !== null) {
    // Confirm to the leaving phone (it keeps its token until this arrives — if the leave or this
    // reply is lost, its reconnect gets LEFT). The socket becomes anonymous; the phone goes Home.
    effects.push(send(socket, { type: 'leftGame' }));
    const connection = draft.connections[socket];
    if (connection) delete connection.playerId;
    effects.push(unbind(socket));
  }
  effects.push(broadcast({ type: 'playerLeft', playerId, reason }));
  effects.push(...denyReclaimsFor(draft, playerId));
  if (draft.hostId === playerId) effects.push(...changeHost(draft, pickNewHost(draft)));
  refreshIdle(draft, now);
  return effects;
}

// ── "That's me" (G-44) ──────────────────────────────────────────────────────

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
  sender: Sender,
  _ctx: Ctx,
): Effect[] {
  if (sender.reclaimRequestId === undefined) return [];
  return cancelReclaim(draft, sender.reclaimRequestId, sender.connId);
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
  _sender: Sender,
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

// ── Sockets ─────────────────────────────────────────────────────────────────

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

  if (draft.hostId === null) effects.push(...changeHost(draft, pickNewHost(draft)));
  refreshIdle(draft, ctx.now);
  return effects;
}

/** Photo bytes stored: bump avatar.photoVersion, broadcast playerUpdated. */
export function onPhotoStored(
  draft: GameState,
  event: Extract<EngineEvent, { kind: 'photoStored' }>,
  _ctx: Ctx,
): Effect[] {
  const player = draft.players[event.playerId];
  if (player?.status !== 'active') return [];
  player.avatar.photoVersion = (player.avatar.photoVersion ?? 0) + 1;
  return [
    broadcast({
      type: 'playerUpdated',
      playerId: event.playerId,
      nickname: player.nickname,
      avatar: { ...player.avatar },
    }),
  ];
}

/**
 * Player-side deadlines due at ctx.now: retention after ENDED and idle cleanup (→ deleteGame),
 * host handover (60 s), reclaim expiry (5 min) — see game/deadlines.ts.
 */
export function onPlayerDeadlines(draft: GameState, ctx: Ctx): Effect[] {
  const { retention, hostHandover } = draft.deadlines;
  if (draft.phase === 'ENDED' && retention !== undefined && retention <= ctx.now)
    return [{ kind: 'deleteGame' }]; // G-48
  const idleUntil = idleCleanupAt(draft);
  if (idleUntil !== null && idleUntil <= ctx.now) return [{ kind: 'deleteGame' }];

  const effects: Effect[] = [];
  if (hostHandover !== undefined && hostHandover <= ctx.now) effects.push(...runHandover(draft));
  effects.push(...expireReclaims(draft, ctx.now));
  return effects;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Make `connId` the player's current socket and send them a welcome. A previous socket of the same
 * player is told REPLACED and closed (G-18) — its later close won't mark them offline.
 */
function attachAsPlayer(
  draft: GameState,
  playerId: PlayerId,
  connId: ConnId,
  now: number,
): Effect[] {
  const replaced: Effect[] = [];
  const previous = draft.players[playerId]?.connId ?? null;
  if (previous !== null && previous !== connId) {
    replaced.push(
      send(previous, { type: 'error', code: 'REPLACED' }),
      close(previous, WS_CLOSE.REPLACED, 'replaced'),
    );
  }
  // All state changes first; then the welcome (built from the result) goes out BEFORE any delta
  // this socket would also receive — "welcome first" (CLAUDE.md §5, checked in test/game/helpers).
  // Coming back online also auto-denies a pending "That's me" for this player (G-44, in setOnline).
  const deltas = setOnline(draft, playerId, connId, now);
  cancelHandoverIfHostOnline(draft);
  deltas.push(...fillVacantHost(draft, playerId));
  return [
    ...replaced,
    bindToPlayer(connId, playerId),
    welcome(draft, playerId, connId, now),
    ...deltas,
  ];
}

function welcome(draft: GameState, playerId: PlayerId, connId: ConnId, now: number): Effect {
  return send(connId, {
    type: 'welcome',
    playerId,
    gameId: draft.gameId,
    snapshot: buildSnapshot(draft, playerId),
    serverTime: now,
  });
}

/** Older phone → reload; newer phone (this object still runs old code) → retry (CLAUDE.md §4). */
function protocolMismatch(version: number): 'OUTDATED_CLIENT' | 'SERVER_UPDATING' | null {
  if (version < PROTOCOL_VERSION) return 'OUTDATED_CLIENT';
  if (version > PROTOCOL_VERSION) return 'SERVER_UPDATING';
  return null;
}

function findPlayerByToken(
  state: GameState,
  tokenHash: string,
): [PlayerId, PlayerState] | undefined {
  return entriesOf(state.players).find(([, player]) => player.tokenHash === tokenHash);
}

/** A player this token USED to belong to, before an approved "That's me" (G-44). */
function findPlayerByPreviousToken(
  state: GameState,
  tokenHash: string,
): [PlayerId, PlayerState] | undefined {
  return entriesOf(state.players).find(([, player]) =>
    player.previousTokenHashes.includes(tokenHash),
  );
}

function findReclaimByToken(
  state: GameState,
  tokenHash: string,
): [RequestId, ReclaimState] | undefined {
  return entriesOf(state.reclaims).find(([, r]) => r.requesterTokenHash === tokenHash);
}

/** The sender's player — the engine guarantees it for messages with sender kind 'player'. */
function senderPlayer(draft: GameState, sender: Sender): [PlayerId, PlayerState] {
  const playerId = sender.playerId;
  const player = playerId === undefined ? undefined : draft.players[playerId];
  if (playerId === undefined || player === undefined)
    throw new Error('Engine contract broken: player message without a player');
  return [playerId, player];
}

function leastShown(draft: GameState): number {
  const shown = activePlayers(draft).map(([, player]) => player.timesShown);
  return shown.length === 0 ? 0 : Math.min(...shown);
}
