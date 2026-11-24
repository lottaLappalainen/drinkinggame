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
import type { PresetId } from '../shared/avatars';
import type { WS_CLOSE } from '../shared/constants';
import type { GameState, PlayerState } from './stateSchema';

export type { GameState };

// ── Engine-facing client messages ───────────────────────────────────────────
// On the wire, `hello` and `reclaim` carry the phone's raw token. The DO hashes it synchronously
// (node:crypto) BEFORE the engine sees the message, so the engine only ever handles hashes.
// (hello carries no protocol version — that comes with the socket, see `connectionOpened`.)
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
  /**
   * A socket opened during normal operation. It is registered as anonymous until identified.
   * `protocolVersion` comes from the WebSocket URL (`/ws/KEY?v=N`; missing or unreadable → 0, i.e.
   * outdated) and is stored in the socket's attachment by the DO at accept time — the single source
   * for both this event and later `rebuild`s (CLAUDE.md §4).
   */
  | { readonly kind: 'connectionOpened'; readonly connId: ConnId; readonly protocolVersion: number }
  /** A socket closed (or was found dead by the liveness check). */
  | { readonly kind: 'connectionClosed'; readonly connId: ConnId }
  /**
   * The DO (re)loaded its state (hibernation wake, deploy, restart): ALL sockets that exist,
   * with what their attachments say. Emits effects ONLY for real changes (CLAUDE.md §3): after a
   * plain hibernation wake everything matches and nothing is sent; if a player's socket is gone,
   * the others hear playerConnection — and if that ends the round or flips the pause flag, the
   * usual roundResults / paused messages go out, so connected phones never wait forever.
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
  readonly presetId: PresetId;
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
  /**
   * Send to every online active player (optionally except some) — delivered to each player's
   * CURRENT socket, `players[p].connId`, and nowhere else. NOT "every socket whose attachment says
   * playerId": a replaced socket keeps that until it closes (G-18) and must not get game updates.
   */
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
      readonly code: WsCloseCode;
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

export type WsCloseCode = (typeof WS_CLOSE)[keyof typeof WS_CLOSE];

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
 * The sender of a message only an active player may send (MESSAGE_RULES sender 'player'), resolved
 * ONCE by the engine: `player` is that player's record in the draft (active, on this very socket),
 * so handlers neither look it up again nor re-check that it exists.
 */
export type PlayerSender = {
  readonly connId: ConnId;
  readonly playerId: PlayerId;
  readonly player: PlayerState;
};

/** The sender of a message only a "That's me" requester may send (sender kind 'requester'). */
export type RequesterSender = { readonly connId: ConnId; readonly requestId: RequestId };
