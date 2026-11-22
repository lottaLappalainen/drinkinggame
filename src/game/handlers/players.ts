// Player-side game logic — filled by Phase 3A (.claude/phases/phase-3-game-logic.md).
// Stubs only in Phase 2: the signatures are the contract; the JSDoc names the rules to implement.
//
// Conventions for every handler here:
// - MUTATE `draft` (a private deep copy owned by the engine); return the effects.
// - The engine has already checked: sender identity, host-only, phase, stale roundId.
// - Never decide round end / ready counter / pause here — that is rounds.onPlayersChanged,
//   which the engine calls automatically after any change to who is online or active.
import type { PlayerId, Snapshot } from '../../shared/protocol';
import { NotImplementedError } from '../notImplemented';
import type { GameState } from '../stateSchema';
import type {
  ClaimEvent,
  ClaimResult,
  Ctx,
  Effect,
  EngineEvent,
  EngineMessageOf,
  Sender,
} from '../types';

const OWNER = 'Phase 3A';

/**
 * Create a game from a claim (G-10): a lobby with the creator as host. Validates the nickname
 * (G-1) and preset; generates gameId and playerId with ctx.random.
 */
export function claimGame(_event: ClaimEvent, _ctx: Ctx): ClaimResult {
  throw new NotImplementedError(OWNER, 'claimGame (G-10, G-1)');
}

/**
 * `hello` (CLAUDE.md §5): token hash known → resume (or collect a reclaim result); left/removed →
 * LEFT / REMOVED; unknown + nickname → join as new (G-13 limit, G-14 name taken incl.
 * reclaimPlayerId for offline owners, G-15 late join); unknown without nickname, gameId mismatch,
 * or new join to an ENDED game → NOT_FOUND (G-12); ENDED 'updated' → gameEnded. Newest socket
 * wins: send REPLACED to the old connId, then close it (G-18). Emits welcome + bindConnection.
 */
export function handleHello(
  _draft: GameState,
  _msg: EngineMessageOf<'hello'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'hello (G-12…G-18, G-44 collect)');
}

/** Own nickname / preset, LOBBY only (G-1, G-5, G-6). photoVersion is never set here. */
export function handleUpdateProfile(
  _draft: GameState,
  _msg: EngineMessageOf<'updateProfile'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'updateProfile (G-5, G-6)');
}

/** Host, LOBBY only: 15 / 25 / 35 (G-20). */
export function handleSetGameLength(
  _draft: GameState,
  _msg: EngineMessageOf<'setGameLength'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'setGameLength (G-20)');
}

/**
 * Leave for good (G-41): status 'left', token stays on record (→ LEFT later), not counted, name
 * freed, not rankable later, pending reclaims targeting them closed; host leaving → immediate
 * handover (or vacant host).
 */
export function handleLeave(
  _draft: GameState,
  _msg: EngineMessageOf<'leave'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'leave (G-41)');
}

/** Host removes a player offline ≥ REMOVE_OFFLINE_MIN_MS (G-43); same effects as leaving. */
export function handleRemovePlayer(
  _draft: GameState,
  _msg: EngineMessageOf<'removePlayer'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'removePlayer (G-43)');
}

/**
 * "That's me" (G-44) — only from an ANONYMOUS connection (engine rule): target active + offline +
 * no other pending request → create request with the requester's token hash, bindConnection to
 * the request, reclaimPending to requester, reclaimRequested to host. Otherwise
 * RECLAIM_UNAVAILABLE. Delivering a result later binds the connection back to anonymous (or to
 * the player on approval), so a denied requester can try again.
 */
export function handleReclaim(
  _draft: GameState,
  _msg: EngineMessageOf<'reclaim'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'reclaim (G-44)');
}

/** Requester cancels (G-44): drop the request, reclaimClosed to host. */
export function handleCancelReclaim(
  _draft: GameState,
  _msg: EngineMessageOf<'cancelReclaim'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'cancelReclaim (G-44)');
}

/**
 * Host answers (G-44): on approve re-check the target is still active and offline (else deny);
 * approval sets the player's tokenHash to the requester's; deliver the result if the requester
 * is connected (approval → reclaimResult + welcome as that player).
 */
export function handleAnswerReclaim(
  _draft: GameState,
  _msg: EngineMessageOf<'answerReclaim'>,
  _sender: Sender,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'answerReclaim (G-44)');
}

/** Socket opened: register it in `connections` as anonymous (with its protocolVersion). */
export function onConnectionOpened(
  _draft: GameState,
  _event: Extract<EngineEvent, { kind: 'connectionOpened' }>,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'connectionOpened');
}

/**
 * Socket closed: drop it from `connections`; mark the player offline ONLY if it was their current
 * connId (a replaced older socket closing must not); idleSince; host-handover deadline.
 */
export function onConnectionClosed(
  _draft: GameState,
  _event: Extract<EngineEvent, { kind: 'connectionClosed' }>,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'connectionClosed');
}

/**
 * Reconcile state with the live sockets after a load (CLAUDE.md §3/§4): drop connections whose
 * socket is gone, adopt sockets the state doesn't know, adjust connectedSince/offlineSince and
 * idleSince, only ADD missing deadlines (e.g. host handover). Emit effects ONLY for real changes
 * (e.g. playerConnection for a player whose socket vanished) — a plain hibernation wake where
 * everything matches returns []. The engine then calls onPlayersChanged as for any event.
 */
export function onRebuild(
  _draft: GameState,
  _event: Extract<EngineEvent, { kind: 'rebuild' }>,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'rebuild');
}

/** Photo bytes stored: bump avatar.photoVersion, broadcast playerUpdated. */
export function onPhotoStored(
  _draft: GameState,
  _event: Extract<EngineEvent, { kind: 'photoStored' }>,
  _ctx: Ctx,
): Effect[] {
  throw new NotImplementedError(OWNER, 'photoStored');
}

/**
 * Player-side deadlines that are due at ctx.now: host handover (60 s), reclaim expiry (5 min),
 * retention after ENDED (deleteGame), idle cleanup (deleteGame) — see game/deadlines.ts.
 */
export function onPlayerDeadlines(_draft: GameState, _ctx: Ctx): Effect[] {
  throw new NotImplementedError(OWNER, 'player deadlines');
}

/**
 * The per-viewer snapshot sent in `welcome` (shape: SnapshotSchema, a variant on phase). Never
 * includes answers, tokens or token hashes; reclaims only for the host; `you.submitted` (QUESTION
 * only) for the reconnect case. Must satisfy checkSnapshotInvariants (game/invariants.ts).
 */
export function buildSnapshot(_state: GameState, _viewer: PlayerId, _now: number): Snapshot {
  throw new NotImplementedError(OWNER, 'buildSnapshot');
}
