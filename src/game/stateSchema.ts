// The saved game state (CLAUDE.md §4 "State shape"). Defined as a Valibot schema so the server can
// validate every loaded state — a forgotten STATE_VERSION bump is still caught (→ game ends as
// 'updated'). strictObject: a field removed in new code makes an old saved state invalid, too.
//
// Plain serializable data only (no classes, Maps, Dates) so it round-trips through storage.
import * as v from 'valibot';
import { DEFAULT_GAME_LENGTH, ENDED_RETENTION_MS, STATE_VERSION } from '../shared/constants';
import {
  AvatarSchema,
  ConnIdSchema,
  EndReasonSchema,
  GameIdSchema,
  GameKeySchema,
  GameLengthSchema,
  PhaseSchema,
  PlayerIdSchema,
  PlayerStatusSchema,
  PresetIdSchema,
  RequestIdSchema,
  RoundIdSchema,
  QuestionSchema,
  RoundResultsSchema,
  TimestampSchema,
  type ConnId,
  type GameId,
  type GameKey,
  type PlayerId,
} from '../shared/protocol';
import type { PresetId } from '../shared/avatars';

/** SHA-256 of a phone-generated token, hex. Raw tokens are never stored. */
export const TokenHashSchema = v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/));

const Count = v.pipe(v.number(), v.integer(), v.minValue(0));

export const PlayerStateSchema = v.strictObject({
  nickname: v.string(),
  /** Normalized nickname for "Name taken" (G-14) — see shared/nickname.ts `nameKey`. */
  nameKey: v.string(),
  avatar: AvatarSchema,
  /** Kept after leave/remove so that phone gets LEFT / REMOVED instead of "Game not found". */
  tokenHash: TokenHashSchema,
  /** The player's CURRENT socket; null = offline. A closing older socket must not mark them offline. */
  connId: v.nullable(ConnIdSchema),
  joinedAt: TimestampSchema,
  /** Saved timestamps (the online FLAG itself is derived from live sockets on every load). */
  connectedSince: v.nullable(TimestampSchema),
  offlineSince: v.nullable(TimestampSchema),
  /** First roundId this player takes part in (late joiners, G-15). 1 = from the start. */
  activeFromRound: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** How often shown as a candidate — fair selection (G-35). */
  timesShown: Count,
  status: PlayerStatusSchema,
  /** Reserved for the drinking rules and the Game Over summary (U3); kept up to date by 3B. */
  stats: v.strictObject({
    timesFirst: Count,
    timesLast: Count,
    answered: Count,
    missed: Count,
  }),
});

export const ConnectionStateSchema = v.strictObject({
  playerId: v.exactOptional(PlayerIdSchema),
  reclaimRequestId: v.exactOptional(RequestIdSchema),
  protocolVersion: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export const ReclaimStateSchema = v.strictObject({
  targetPlayerId: PlayerIdSchema,
  /** The requester phone's own token hash — becomes the player's tokenHash on approval. */
  requesterTokenHash: TokenHashSchema,
  nickname: v.string(),
  presetId: PresetIdSchema,
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema,
  status: v.picklist(['pending', 'approved', 'denied']),
});

export const RoundStateSchema = v.strictObject({
  roundId: RoundIdSchema,
  /** Index into `questions`. */
  index: v.pipe(v.number(), v.integer(), v.minValue(0)),
  candidates: v.array(PlayerIdSchema),
  participants: v.array(PlayerIdSchema),
  startedAt: TimestampSchema,
  answerStartsAt: TimestampSchema,
  endsAt: TimestampSchema,
  /** Rankings by player. NEVER sent to clients; the keys are the ready list (G-38). */
  answers: v.record(PlayerIdSchema, v.array(PlayerIdSchema)),
  /** Computed exactly once at QUESTION → RESULTS. Carries revealStartsAt / revealEndsAt. */
  results: v.nullable(RoundResultsSchema),
});

export const GameStateSchema = v.strictObject({
  stateVersion: v.literal(STATE_VERSION),
  gameId: GameIdSchema,
  key: GameKeySchema,
  phase: PhaseSchema,
  endReason: v.nullable(EndReasonSchema),
  /** Too few active players (G-42) — only blocks starting the next question. */
  paused: v.boolean(),
  /** null = host role vacant until the next active player connects. */
  hostId: v.nullable(PlayerIdSchema),
  settings: v.strictObject({ gameLength: GameLengthSchema }),
  players: v.record(PlayerIdSchema, PlayerStateSchema),
  connections: v.record(ConnIdSchema, ConnectionStateSchema),
  reclaims: v.record(RequestIdSchema, ReclaimStateSchema),
  /**
   * Drawn once at start, no repeats (G-31) — stored with their TEXT, so the running game never
   * depends on the bank again: editing or removing questions and deploying mid-party is safe.
   * (~4 KB for 35 questions.)
   */
  questions: v.array(QuestionSchema),
  round: v.nullable(RoundStateSchema),
  /** When the last identified player's socket closed; null while any player is online. */
  idleSince: v.nullable(TimestampSchema),
  deadlines: v.strictObject({
    roundEnd: v.exactOptional(TimestampSchema),
    hostHandover: v.exactOptional(TimestampSchema),
    retention: v.exactOptional(TimestampSchema),
  }),
});

export type GameState = v.InferOutput<typeof GameStateSchema>;
export type PlayerState = v.InferOutput<typeof PlayerStateSchema>;
export type ConnectionState = v.InferOutput<typeof ConnectionStateSchema>;
export type ReclaimState = v.InferOutput<typeof ReclaimStateSchema>;
export type RoundState = v.InferOutput<typeof RoundStateSchema>;

export type NewPlayerInput = {
  readonly nickname: string;
  readonly nameKey: string;
  readonly presetId: PresetId;
  readonly tokenHash: string;
  readonly now: number;
  readonly activeFromRound: number;
};

/** A fresh player record (offline until their socket connects). */
export function createPlayer(input: NewPlayerInput): PlayerState {
  return {
    nickname: input.nickname,
    nameKey: input.nameKey,
    avatar: { presetId: input.presetId, photoVersion: null },
    tokenHash: input.tokenHash,
    connId: null,
    joinedAt: input.now,
    connectedSince: null,
    offlineSince: input.now,
    activeFromRound: input.activeFromRound,
    timesShown: 0,
    status: 'active',
    stats: { timesFirst: 0, timesLast: 0, answered: 0, missed: 0 },
  };
}

export type CreateGameInput = {
  readonly key: GameKey;
  readonly gameId: GameId;
  readonly hostId: PlayerId;
  readonly host: Omit<NewPlayerInput, 'activeFromRound'>;
};

/** Initial state after a successful claim: a lobby with the creator as host (G-10). */
export function createGame(input: CreateGameInput): GameState {
  return {
    stateVersion: STATE_VERSION,
    gameId: input.gameId,
    key: input.key,
    phase: 'LOBBY',
    endReason: null,
    paused: false,
    hostId: input.hostId,
    settings: { gameLength: DEFAULT_GAME_LENGTH },
    players: { [input.hostId]: createPlayer({ ...input.host, activeFromRound: 1 }) },
    connections: {},
    reclaims: {},
    questions: [],
    round: null,
    // Nobody connected yet: the lobby idles until the host's phone connects.
    idleSince: input.host.now,
    deadlines: {},
  };
}

/**
 * Replacement for a saved state that failed the version/schema check on load: an ENDED game
 * with reason 'updated', kept for the usual retention so reconnecting phones are told
 * "The game was updated" instead of "Game not found" (CLAUDE.md §4).
 */
export function createUpdatedEndState(input: {
  readonly key: GameKey;
  readonly gameId: GameId;
  readonly now: number;
}): GameState {
  return {
    stateVersion: STATE_VERSION,
    gameId: input.gameId,
    key: input.key,
    phase: 'ENDED',
    endReason: 'updated',
    paused: false,
    hostId: null,
    settings: { gameLength: DEFAULT_GAME_LENGTH },
    players: {},
    connections: {},
    reclaims: {},
    questions: [],
    round: null,
    idleSince: null,
    deadlines: { retention: input.now + ENDED_RETENTION_MS },
  };
}

/** Reconnect identity helper type re-exported for handler signatures. */
export type { ConnId };
