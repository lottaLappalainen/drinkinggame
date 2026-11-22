// The game engine's single entry point (CLAUDE.md §3 "Engine contract").
//
// applyEvent(state, event, ctx) → { state, effects, changed }
//
// This file contains NO game rules — only routing and the checks common to every message:
// who the sender is, host-only actions, allowed phases, stale roundIds. Rules live in
// handlers/players.ts (3A) and handlers/rounds.ts (3B).
//
// Mutation model: the engine deep-copies the state into a private `draft`, handlers mutate the
// draft, and the engine compares before/after to report `changed` (the DO skips the storage
// write when nothing changed, e.g. for timeSync or rejected messages).
import type { ErrorCode, Phase, ServerMessage } from '../shared/protocol';
import * as players from './handlers/players';
import * as rounds from './handlers/rounds';
import type { GameState } from './stateSchema';
import type {
  ClaimEvent,
  ClaimResult,
  Ctx,
  Effect,
  EngineClientMessage,
  EngineEvent,
  EngineResult,
  Sender,
} from './types';

// ── Message rules ───────────────────────────────────────────────────────────

type SenderKind =
  /** Any registered connection (identified or not). */
  | 'anyone'
  /** An active player whose CURRENT socket this is. */
  | 'player'
  /** A connection waiting on a "That's me" request. */
  | 'requester';

type MessageRule = {
  readonly sender: SenderKind;
  readonly hostOnly?: true;
  readonly phases: readonly Phase[];
  /** Carries a roundId; a stale one is silently ignored (double taps, late answers). */
  readonly roundBound?: true;
};

const ALL: readonly Phase[] = ['LOBBY', 'QUESTION', 'RESULTS', 'ENDED'];
const NOT_ENDED: readonly Phase[] = ['LOBBY', 'QUESTION', 'RESULTS'];

/** One rule per client message type — a missing type is a compile error. */
export const MESSAGE_RULES: { readonly [T in EngineClientMessage['type']]: MessageRule } = {
  hello: { sender: 'anyone', phases: ALL },
  timeSync: { sender: 'anyone', phases: ALL },
  reclaim: { sender: 'anyone', phases: NOT_ENDED },
  cancelReclaim: { sender: 'requester', phases: ALL },
  updateProfile: { sender: 'player', phases: ['LOBBY'] },
  setGameLength: { sender: 'player', hostOnly: true, phases: ['LOBBY'] },
  start: { sender: 'player', hostOnly: true, phases: ['LOBBY'] },
  submit: { sender: 'player', phases: ['QUESTION'], roundBound: true },
  advance: { sender: 'player', hostOnly: true, phases: ['RESULTS'], roundBound: true },
  end: { sender: 'player', hostOnly: true, phases: NOT_ENDED },
  leave: { sender: 'player', phases: ALL },
  removePlayer: { sender: 'player', hostOnly: true, phases: NOT_ENDED },
  answerReclaim: { sender: 'player', hostOnly: true, phases: NOT_ENDED },
};

// ── Entry points ────────────────────────────────────────────────────────────

/** Apply one event to an existing game. Never mutates `state`. */
export function applyEvent(state: GameState, event: EngineEvent, ctx: Ctx): EngineResult {
  const before = JSON.stringify(state);
  const draft = JSON.parse(before) as GameState;
  const playersBefore = playerSetKey(draft);

  let effects: Effect[];
  switch (event.kind) {
    case 'message':
      effects = routeMessage(draft, event.from, event.msg, ctx);
      break;
    case 'connection':
      effects = players.onConnection(draft, event, ctx);
      break;
    case 'rebuild':
      // Silent: after a wake nothing actually changed, so nothing is broadcast (CLAUDE.md §3).
      players.onRebuild(draft, event, ctx);
      rounds.onPlayersChanged(draft, ctx);
      effects = [];
      break;
    case 'photoStored':
      effects = players.onPhotoStored(draft, event, ctx);
      break;
    case 'deadline':
      effects = [...rounds.onRoundDeadlines(draft, ctx), ...players.onPlayerDeadlines(draft, ctx)];
      break;
    default:
      return assertNever(event);
  }

  if (event.kind !== 'rebuild' && playerSetKey(draft) !== playersBefore) {
    effects.push(...rounds.onPlayersChanged(draft, ctx));
  }

  const after = JSON.stringify(draft);
  return after === before
    ? { state, effects, changed: false }
    : { state: draft, effects, changed: true };
}

/** Create a game: the one event applied to no state (the DO is empty until claimed). */
export function applyClaim(event: ClaimEvent, ctx: Ctx): ClaimResult {
  return players.claimGame(event, ctx);
}

// ── Routing ─────────────────────────────────────────────────────────────────

function routeMessage(
  draft: GameState,
  from: string,
  msg: EngineClientMessage,
  ctx: Ctx,
): Effect[] {
  const connection = draft.connections[from];
  // The DO registers every socket (connection event) before forwarding its messages.
  if (connection === undefined) return [errorTo(from, 'NOT_ALLOWED')];

  // Clock sync touches no game state (CLAUDE.md §6 "Timer sync").
  if (msg.type === 'timeSync') {
    return [send(from, { type: 'timeSync', t0: msg.t0, serverTime: ctx.now })];
  }

  const sender: Sender = {
    connId: from,
    ...(connection.playerId !== undefined && { playerId: connection.playerId }),
    ...(connection.reclaimRequestId !== undefined && {
      reclaimRequestId: connection.reclaimRequestId,
    }),
  };
  const rule = MESSAGE_RULES[msg.type];

  if (!senderMatches(draft, sender, rule.sender)) return [errorTo(from, 'NOT_ALLOWED')];
  if (rule.hostOnly && (draft.hostId === null || draft.hostId !== sender.playerId)) {
    return [errorTo(from, 'NOT_ALLOWED')];
  }
  if (!rule.phases.includes(draft.phase)) return [errorTo(from, 'NOT_ALLOWED')];
  if (rule.roundBound && 'roundId' in msg && draft.round?.roundId !== msg.roundId) {
    return []; // stale: a double tap or an answer for a round that is already over
  }

  switch (msg.type) {
    case 'hello':
      return players.handleHello(draft, msg, sender, ctx);
    case 'updateProfile':
      return players.handleUpdateProfile(draft, msg, sender, ctx);
    case 'setGameLength':
      return players.handleSetGameLength(draft, msg, sender, ctx);
    case 'leave':
      return players.handleLeave(draft, msg, sender, ctx);
    case 'removePlayer':
      return players.handleRemovePlayer(draft, msg, sender, ctx);
    case 'reclaim':
      return players.handleReclaim(draft, msg, sender, ctx);
    case 'cancelReclaim':
      return players.handleCancelReclaim(draft, msg, sender, ctx);
    case 'answerReclaim':
      return players.handleAnswerReclaim(draft, msg, sender, ctx);
    case 'start':
      return rounds.handleStart(draft, msg, sender, ctx);
    case 'submit':
      return rounds.handleSubmit(draft, msg, sender, ctx);
    case 'advance':
      return rounds.handleAdvance(draft, msg, sender, ctx);
    case 'end':
      return rounds.handleEnd(draft, msg, sender, ctx);
    default:
      return assertNever(msg);
  }
}

function senderMatches(draft: GameState, sender: Sender, kind: SenderKind): boolean {
  switch (kind) {
    case 'anyone':
      return true;
    case 'requester':
      return sender.reclaimRequestId !== undefined;
    case 'player': {
      if (sender.playerId === undefined) return false;
      const player = draft.players[sender.playerId];
      // A replaced socket that is still open must not act for the player (G-18).
      return player !== undefined && player.status === 'active' && player.connId === sender.connId;
    }
    default:
      return assertNever(kind);
  }
}

/**
 * Fingerprint of "who is online or active". When it changes, the engine calls
 * rounds.onPlayersChanged — so no handler can forget to (CLAUDE.md §3).
 */
function playerSetKey(state: GameState): string {
  return Object.entries(state.players)
    .map(([id, player]) => `${id}:${player.status}:${player.connId === null ? 0 : 1}`)
    .sort()
    .join('|');
}

function send(connId: string, message: ServerMessage): Effect {
  return { kind: 'send', connId, message };
}

function errorTo(connId: string, code: ErrorCode): Effect {
  return send(connId, { type: 'error', code });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
