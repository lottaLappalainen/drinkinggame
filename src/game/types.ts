// The engine contract (CLAUDE.md §3 "Engine contract"): events in, effects out.
// The Durable Object turns everything that happens into an EngineEvent, calls applyEvent,
// persists the state if `changed`, executes the effects, and sets the alarm to nextDeadline().
import type {
  ClientMessage,
  ConnId,
  ErrorCode,
  GameKey,
  MessageOf,
  PlayerId,
  RequestId,
  ServerMessage,
} from '../shared/protocol';
import type { GameState } from './stateSchema';

export type { GameState };

// ── Engine-facing client messages ───────────────────────────────────────────
// On the wire, `hello` and `reclaim` carry the phone's raw token. The DO hashes it synchronously
// (node:crypto) BEFORE the engine sees the message, so the engine only ever handles hashes:
//   wire  { type: 'hello',   token, … }  →  engine { type: 'hello',   tokenHash, … }
//   wire  { type: 'reclaim', token, … }  →  engine { type: 'reclaim', tokenHash, … }
// Every other message is passed through unchanged.

type WithTokenHash<M> = Omit<M, 'token'> & { readonly tokenHash: string };

export type EngineHello = WithTokenHash<MessageOf<ClientMessage, 'hello'>>;
export type EngineReclaim = WithTokenHash<MessageOf<ClientMessage, 'reclaim'>>;
export type EngineClientMessage =
  EngineHello | EngineReclaim | Exclude<ClientMessage, { type: 'hello' | 'reclaim' }>;
export type EngineMessageOf<T extends EngineClientMessage['type']> = Extract<
  EngineClientMessage,
  { type: T }
>;

// ── Events ──────────────────────────────────────────────────────────────────

export type EngineEvent =
  /** A validated client message from one socket. The sender is looked up in state.connections. */
  | { readonly kind: 'message'; readonly from: ConnId; readonly msg: EngineClientMessage }
  /** A socket opened or closed during normal operation. Opening registers it as anonymous. */
  | {
      readonly kind: 'connection';
      readonly connId: ConnId;
      readonly online: boolean;
      readonly protocolVersion: number;
    }
  /**
   * The DO (re)loaded its state (hibernation wake, deploy, restart): ALL sockets that exist,
   * with what their attachments say. SILENT — no effects are emitted (CLAUDE.md §3).
   */
  | { readonly kind: 'rebuild'; readonly sockets: readonly RebuildSocket[] }
  /** A photo was stored for this player (bytes saved by the server's upload handler). */
  | { readonly kind: 'photoStored'; readonly playerId: PlayerId }
  /** The alarm fired: run every game deadline that is due. */
  | { readonly kind: 'deadline' };

export type RebuildSocket = {
  readonly connId: ConnId;
  readonly protocolVersion: number;
  readonly playerId?: PlayerId;
  readonly reclaimRequestId?: RequestId;
};

/**
 * Creating a game is the one event applied to NO state (the DO is empty until the claim).
 * Handled by `applyClaim`, not `applyEvent`.
 */
export type ClaimEvent = {
  readonly key: GameKey;
  readonly nickname: string;
  readonly presetId: string;
  readonly tokenHash: string;
};

export type ClaimResult =
  | { readonly ok: true; readonly state: GameState; readonly playerId: PlayerId }
  | { readonly ok: false; readonly error: ErrorCode };

// ── Effects ─────────────────────────────────────────────────────────────────
// Data describing what the DO should do. There is NO deadline effect: deadlines live in the
// state and the DO sets the alarm from nextDeadline(state) after every event.

export type Effect =
  /** Send to one socket (welcome to a new connection, errors to an anonymous one, …). */
  | { readonly kind: 'send'; readonly connId: ConnId; readonly message: ServerMessage }
  /** Send to every online active player (optionally except some). */
  | {
      readonly kind: 'broadcast';
      readonly message: ServerMessage;
      readonly except?: readonly PlayerId[];
    }
  /** Send to the host only (if online). */
  | { readonly kind: 'sendToHost'; readonly message: ServerMessage }
  /** Close one socket (e.g. the player's OLD socket on REPLACED, G-18). */
  | {
      readonly kind: 'close';
      readonly connId: ConnId;
      readonly code: number;
      readonly reason: string;
    }
  /** The connection got identified — the DO updates that socket's attachment. */
  | {
      readonly kind: 'bindConnection';
      readonly connId: ConnId;
      readonly playerId?: PlayerId;
      readonly reclaimRequestId?: RequestId;
    }
  /** Retention or idle cleanup is due: close all sockets, deleteAlarm(), deleteAll(). */
  | { readonly kind: 'deleteGame' };

// ── Context & result ────────────────────────────────────────────────────────

export type Ctx = {
  /** Server time in epoch ms — the only clock the engine may use. */
  readonly now: number;
  /** Uniform random number in [0, 1) — the only randomness the engine may use. */
  readonly random: () => number;
};

export type EngineResult = {
  readonly state: GameState;
  readonly effects: readonly Effect[];
  /** False when nothing in the state changed — the DO then skips the storage write. */
  readonly changed: boolean;
};

/** Who sent a message, resolved by the engine from state.connections. */
export type Sender = {
  readonly connId: ConnId;
  readonly playerId?: PlayerId;
  readonly reclaimRequestId?: RequestId;
};

/**
 * Handler shape used by game/handlers/*: handlers MUTATE `draft` (a private deep copy owned by
 * the engine) and return the effects. The engine detects whether anything changed.
 */
export type Handler<Input> = (draft: GameState, input: Input, ctx: Ctx) => Effect[];
