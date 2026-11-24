// Every limit and timing in the game lives here — no magic numbers anywhere else (CLAUDE.md §6).
// Values marked (unsure) in GAME_DESCRIPTION.md are tuned during UI design / play-testing:
// change them here and nowhere else.

// ── Versions ────────────────────────────────────────────────────────────────
/** Bump on any change to the saved GameState shape (CLAUDE.md §4 "State version + schema"). */
export const STATE_VERSION = 2;
/** Bump on any incompatible wire-protocol change (CLAUDE.md §4 "Deploys and protocol changes"). */
export const PROTOCOL_VERSION = 2;

// ── Players ─────────────────────────────────────────────────────────────────
export const MAX_PLAYERS = 25; // active players per game (G-13)
export const MIN_PLAYERS = 3; // to start (G-21) and to continue without pausing (G-42)
export const NICKNAME_MAX_GRAPHEMES = 16; // G-1 (unsure)
export const NICKNAME_MIN_GRAPHEMES = 1; // G-1

// ── Game setup ──────────────────────────────────────────────────────────────
export const GAME_LENGTHS = [15, 25, 35] as const; // questions per game (G-20)
export const DEFAULT_GAME_LENGTH = 25; // G-20 (default unsure)
export const GAME_KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L (G-11)
export const GAME_KEY_LENGTH = 5; // G-11

// ── Questions ───────────────────────────────────────────────────────────────
// Players shown per question (G-34, decided 2026-11-23): everyone while there are at most
// SHOW_ALL_UP_TO active players; with more, CANDIDATES_WHEN_MORE picked fairly (G-35). Going from
// 6 to 7 players therefore drops a question from 6 to 5 candidates — intended.
export const SHOW_ALL_UP_TO = 6;
export const CANDIDATES_WHEN_MORE = 5;
/** The most candidates a Spotlight question can have. Podium shows everyone (up to MAX_PLAYERS). */
export const MAX_CANDIDATES = Math.max(SHOW_ALL_UP_TO, CANDIDATES_WHEN_MORE);
// Podium mode (G-24): everyone is shown, each voter fills only the top PODIUM_SPOTS. The host can
// pick it only with at least PODIUM_MIN_PLAYERS active players — its own constant on purpose, so
// tuning SHOW_ALL_UP_TO after the phone test doesn't silently move it.
export const PODIUM_SPOTS = 3;
export const PODIUM_MIN_PLAYERS = 7;
export const QUESTION_MAX_LENGTH = 120; // characters, so it fits a phone screen (Q-4, unsure)
/** Questions the always-on Default category must have: the longest game (G-23, G-32). */
export const MIN_QUESTION_BANK_SIZE = 35;

// ── Round timeline (all milliseconds) ───────────────────────────────────────
export const QUESTION_INTRO_MS = 4_000; // question-only screen before answering (G-49, unsure)
export const ROUND_SECONDS = 30; // answer time, counted from answerStartsAt (G-40, unsure)
export const ROUND_MS = ROUND_SECONDS * 1_000;
/** Answers sent at the last moment are still accepted until endsAt + grace (G-39). */
export const ANSWER_GRACE_MS = 500;
/** Results are sent slightly before the reveal starts, so every phone has them in time. */
export const REVEAL_BUFFER_MS = 300;
export const REVEAL_STEP_MS = 2_500; // one reveal step (G-50, unsure)
export const REVEAL_DRUMROLL_MS = 1_500; // extra pause before "most likely" (G-50)
/** The host's Next is accepted this long before revealEndsAt (clock drift tolerance, G-45). */
export const ADVANCE_EARLY_MS = 500;

// ── Scoring & privacy ───────────────────────────────────────────────────────
export const MIN_ANSWERS_FOR_RANKING = 2; // fewer → "Not enough answers" (S-7)
/**
 * With some players unplaced (Podium), fewer answers than this show only the revealed top places —
 * no full ranking, no "No votes" group: with few voters, who got points gives away who picked whom
 * (S-8, unsure). Results never carry vote counts at all (S-6).
 */
export const MIN_ANSWERS_FOR_NO_VOTES_LIST = 5;

// ── Presence, host and cleanup ──────────────────────────────────────────────
export const HOST_HANDOVER_MS = 60_000; // host offline this long → role passes on (§10)
export const REMOVE_OFFLINE_MIN_MS = 120_000; // host may remove a player offline this long (G-43)
export const RECLAIM_TTL_MS = 300_000; // unanswered "That's me" request expires (G-44)
export const ENDED_RETENTION_MS = 600_000; // finished game kept for late reconnects (G-48)
export const IDLE_LOBBY_MS = 30 * 60_000; // nobody connected, lobby → deleted (§10)
export const IDLE_STARTED_MS = 3 * 60 * 60_000; // nobody connected, started game → deleted (§10)
export const LIVENESS_CHECK_MS = 30_000; // server-only stale-socket sweep (CLAUDE.md §6)
export const LIVENESS_TIMEOUT_MS = 45_000; // no ping for this long → socket closed
/**
 * Server: a game deadline still due AFTER an event means the engine failed on it. The alarm is then
 * retried this much later instead of at the (past) deadline — which would fire at once, forever,
 * and burn the free plan's daily request budget.
 */
export const OVERDUE_DEADLINE_RETRY_MS = 10_000;

// ── Client connection ───────────────────────────────────────────────────────
export const CLIENT_PING_MS = 20_000; // phone heartbeat; answered by the runtime's auto-response
export const PING_MESSAGE = 'ping';
export const PONG_MESSAGE = 'pong';
export const TIME_SYNC_SAMPLES = 5; // clock-offset samples after each (re)connect
export const RECONNECT_MIN_MS = 250;
export const RECONNECT_MAX_MS = 5_000;
/**
 * Screen back on while the socket still looks open (iOS keeps dead sockets): ping, and reconnect if
 * no pong arrives this soon — instead of waiting up to CLIENT_PING_MS for the next heartbeat.
 */
export const VISIBLE_PONG_TIMEOUT_MS = 3_000;
export const OUTDATED_RELOAD_MIN_INTERVAL_MS = 60_000; // at most one automatic reload per minute

// ── Limits on input ─────────────────────────────────────────────────────────
export const MAX_MESSAGE_BYTES = 4_096; // incoming WebSocket message / create-game body (UTF-8 bytes)
export const MAX_PHOTO_BYTES = 65_536; // uploaded profile photo
/**
 * Sockets that are neither a player nor a "That's me" requester (a tab left on the join screen).
 * They live in the saved state and survive the liveness check as long as they ping, so they are
 * capped per game; one more is closed at once (TOO_MANY_CONNECTIONS).
 */
export const MAX_ANONYMOUS_CONNECTIONS = 50;
/** Random game keys tried by POST /api/games before giving up with CREATE_FAILED. */
export const CREATE_GAME_ATTEMPTS = 5;
export const PHOTO_SIZE_PX = 192; // photos are cropped/resized to this square on the phone

// ── WebSocket close codes (4000–4999 are free for applications) ─────────────
export const WS_CLOSE = {
  /** The same player connected again elsewhere; this socket is replaced (G-18). */
  REPLACED: 4001,
  /** The game was deleted (retention or idle cleanup). */
  GAME_DELETED: 4002,
  /** Server-side liveness check: no ping for too long. */
  STALE: 4003,
  /** The phone's protocol version doesn't match the server's. */
  PROTOCOL_MISMATCH: 4004,
  /**
   * No game under this key (G-12). Sent after accepting the socket, never as an HTTP 404 before
   * it: browsers hide a failed upgrade's status, so the phone couldn't tell it from a network drop.
   */
  NOT_FOUND: 4005,
  /** Too many sockets that never said who they are (MAX_ANONYMOUS_CONNECTIONS). */
  TOO_MANY_CONNECTIONS: 4006,
} as const;
