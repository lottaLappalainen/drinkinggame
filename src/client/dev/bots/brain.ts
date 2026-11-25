// What a test bot does (step 10d): a PURE function from the server's messages to what the bot
// sends now and what it sends later. No browser APIs, no clock, no randomness of its own —
// `bot.ts` wires it to a real connection; tests drive it directly.
//
// A bot is an ordinary player: it joins with a name, answers every question it takes part in with
// a random ranking of exactly `round.spots` shown players, and — only if the host role lands on it —
// presses Next after each reveal so a game never gets stuck.
import type { PresetId } from '../../../shared/avatars';
import type {
  ClientMessage,
  GameId,
  PlayerId,
  PublicRound,
  ServerMessage,
  Snapshot,
} from '../../../shared/protocol';

export const ANSWER_SPEEDS = ['fast', 'normal', 'slow', 'never'] as const;
export type AnswerSpeed = (typeof ANSWER_SPEEDS)[number];

/** When a bot answers, counted from the moment answering opens (ms, min…max). */
export const ANSWER_DELAY_MS: {
  readonly [K in Exclude<AnswerSpeed, 'never'>]: readonly [number, number];
} = {
  fast: [1_000, 3_000],
  normal: [3_000, 20_000],
  slow: [15_000, 35_000], // some miss the 30 s window on purpose
};
/** A bot holding the host role presses Next this long after the reveal ends. */
export const BOT_ADVANCE_AFTER_MS = 1_500;
/** After TOO_EARLY (clock slightly off) the bot tries again this much later. */
const RETRY_MS = 1_000;

export type BotState = {
  readonly token: string;
  readonly name: string;
  readonly presetId: PresetId;
  /** null until the first welcome: until then every hello asks to join. */
  readonly playerId: PlayerId | null;
  readonly gameId: GameId | null;
  readonly hostId: PlayerId | null;
  readonly phase: Snapshot['phase'] | null;
  /** The round being answered or revealed; null in the lobby and after the game. */
  readonly roundId: number | null;
  /** This bot has answered (or decided not to) for `roundId` — never twice, even after a reconnect. */
  readonly submitted: boolean;
  readonly revealEndsAt: number | null;
  /** The last answer sent, to retry it after TOO_EARLY. */
  readonly lastSubmit: SubmitMessage | null;
  /** Why the bot gave up (it closes its connection); null while it plays. */
  readonly stopped: string | null;
};

type SubmitMessage = Extract<ClientMessage, { type: 'submit' }>;
type AdvanceMessage = Extract<ClientMessage, { type: 'advance' }>;

/** A message to send at a given SERVER time (the bot converts it with its synced clock). */
export type Scheduled = { readonly at: number; readonly message: SubmitMessage | AdvanceMessage };

export type BotStep = {
  readonly state: BotState;
  readonly send: readonly ClientMessage[];
  readonly schedule: readonly Scheduled[];
};

export type BotContext = {
  /** Uniform in [0, 1). */
  readonly random: () => number;
  readonly speed: AnswerSpeed;
  /** The server's time now (the bot's synced clock). */
  readonly now: number;
  /** Another free bot name after "Name taken", or null when none is left. */
  readonly takeName: () => string | null;
};

export function newBot(token: string, name: string, presetId: PresetId): BotState {
  return {
    token,
    name,
    presetId,
    playerId: null,
    gameId: null,
    hostId: null,
    phase: null,
    roundId: null,
    submitted: false,
    revealEndsAt: null,
    lastSubmit: null,
    stopped: null,
  };
}

/**
 * The first message on every new socket. Asks to join until the server has answered once
 * (welcome); after that only the token, like a phone's automatic reconnect (CLAUDE.md §5).
 */
export function hello(state: BotState): ClientMessage {
  if (state.playerId === null)
    return {
      type: 'hello',
      token: state.token,
      join: { nickname: state.name, presetId: state.presetId },
    };
  return {
    type: 'hello',
    token: state.token,
    ...(state.gameId !== null && { gameId: state.gameId }),
  };
}

const nothing = (state: BotState): BotStep => ({ state, send: [], schedule: [] });
const stop = (state: BotState, reason: string): BotStep => nothing({ ...state, stopped: reason });

export function receive(state: BotState, message: ServerMessage, ctx: BotContext): BotStep {
  if (state.stopped !== null) return nothing(state);
  switch (message.type) {
    case 'welcome':
      return fromSnapshot(
        { ...state, playerId: message.playerId, gameId: message.gameId },
        message.snapshot,
        ctx,
      );
    case 'newGame': // "Play again": the same game is a fresh lobby (G-52)
      return fromSnapshot(state, message.snapshot, ctx);
    case 'roundStarted': {
      const next: BotState = {
        ...state,
        phase: 'QUESTION',
        roundId: message.round.roundId,
        submitted: false,
        revealEndsAt: null,
        lastSubmit: null,
      };
      return answer(next, message.round, ctx);
    }
    case 'roundResults': {
      const next: BotState = {
        ...state,
        phase: 'RESULTS',
        roundId: message.results.roundId,
        submitted: true,
        revealEndsAt: message.results.revealEndsAt,
      };
      return advanceIfHost(next);
    }
    case 'hostChanged':
      return advanceIfHost({ ...state, hostId: message.hostId });
    case 'resumed': // the pause ended: Next works again (G-42)
      return advanceIfHost(state);
    case 'gameEnded':
      // Stay connected: the host may tap "Play again" (G-52). The game's deletion closes the socket.
      return nothing({ ...state, phase: 'ENDED', roundId: null, revealEndsAt: null });
    case 'leftGame':
      return stop(state, 'left the game'); // = bot.ts LEFT
    case 'error':
      return onError(state, message, ctx);
    default:
      return nothing(state);
  }
}

/** A scheduled message is due: send it only if it still makes sense (the round may have moved on). */
export function due(
  state: BotState,
  scheduled: Scheduled,
): { state: BotState; send: ClientMessage | null } {
  const { message } = scheduled;
  if (state.stopped !== null || state.roundId !== message.roundId) return { state, send: null };
  if (message.type === 'submit') {
    if (state.phase !== 'QUESTION' || state.submitted) return { state, send: null };
    return { state: { ...state, submitted: true, lastSubmit: message }, send: message };
  }
  const isHost = state.playerId !== null && state.hostId === state.playerId;
  if (state.phase !== 'RESULTS' || !isHost) return { state, send: null };
  return { state, send: message };
}

function fromSnapshot(state: BotState, snapshot: Snapshot, ctx: BotContext): BotStep {
  const base: BotState = { ...state, hostId: snapshot.hostId, phase: snapshot.phase };
  switch (snapshot.phase) {
    case 'LOBBY':
    case 'ENDED':
      return nothing({ ...base, roundId: null, submitted: false, revealEndsAt: null });
    case 'QUESTION': {
      const next: BotState = {
        ...base,
        roundId: snapshot.round.roundId,
        // Already answered this round (a reconnect after Ready) → never again (G-37).
        submitted: snapshot.you.submitted,
        revealEndsAt: null,
      };
      return next.submitted ? nothing(next) : answer(next, snapshot.round, ctx);
    }
    case 'RESULTS':
      return advanceIfHost({
        ...base,
        roundId: snapshot.round.roundId,
        submitted: true,
        revealEndsAt: snapshot.results.revealEndsAt,
      });
    default: {
      const unknown: never = snapshot;
      return unknown;
    }
  }
}

/** Plan this round's answer: a random ranking of exactly `spots` shown players (both modes). */
function answer(state: BotState, round: PublicRound, ctx: BotContext): BotStep {
  const me = state.playerId;
  // Late joiners watch their first question (G-19); "never" bots don't answer at all.
  if (me === null || !round.participants.includes(me) || ctx.speed === 'never')
    return nothing(state);
  const [min, max] = ANSWER_DELAY_MS[ctx.speed];
  const delay = min + Math.floor(ctx.random() * (max - min + 1));
  const ranking = shuffled(round.candidates, ctx.random).slice(0, round.spots);
  return {
    state,
    send: [],
    schedule: [
      {
        at: round.answerStartsAt + delay,
        message: { type: 'submit', roundId: round.roundId, ranking },
      },
    ],
  };
}

/** If this bot holds the host role, press Next once the reveal is over (G-45). */
function advanceIfHost(state: BotState): BotStep {
  const isHost = state.playerId !== null && state.hostId === state.playerId;
  if (!isHost || state.phase !== 'RESULTS' || state.roundId === null || state.revealEndsAt === null)
    return nothing(state);
  return {
    state,
    send: [],
    schedule: [
      {
        at: state.revealEndsAt + BOT_ADVANCE_AFTER_MS,
        message: { type: 'advance', roundId: state.roundId },
      },
    ],
  };
}

function onError(
  state: BotState,
  error: Extract<ServerMessage, { type: 'error' }>,
  ctx: BotContext,
): BotStep {
  switch (error.code) {
    case 'NAME_TAKEN': {
      // Someone (a person or another bot) already has this name: take the next free one.
      const name = ctx.takeName();
      if (name === null) return stop(state, 'no free name left');
      const next = { ...state, name };
      return { state: next, send: [hello(next)], schedule: [] };
    }
    case 'TOO_EARLY': {
      // The bot's clock is a little off: try the same thing again in a moment.
      if (error.for === 'submit' && state.lastSubmit !== null)
        return {
          state: { ...state, submitted: false },
          send: [],
          schedule: [{ at: ctx.now + RETRY_MS, message: state.lastSubmit }],
        };
      if (error.for === 'advance' && state.roundId !== null)
        return {
          state,
          send: [],
          schedule: [
            { at: ctx.now + RETRY_MS, message: { type: 'advance', roundId: state.roundId } },
          ],
        };
      return nothing(state);
    }
    case 'GAME_FULL':
      return stop(state, 'the game is full');
    case 'NOT_FOUND':
      return stop(state, 'game not found');
    case 'INVALID_NICKNAME':
      return stop(state, 'invalid name');
    case 'LEFT':
      return stop(state, 'left the game');
    case 'REMOVED':
      return stop(state, 'removed by the host');
    case 'RECLAIMED':
      return stop(state, 'its spot was taken over');
    case 'OUTDATED_CLIENT':
    case 'SERVER_UPDATING':
      return stop(state, 'the app was updated: reload the page');
    default:
      // PAUSED (wait for "resumed"), NOT_ALLOWED, INVALID, …: nothing to do.
      return nothing(state);
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
