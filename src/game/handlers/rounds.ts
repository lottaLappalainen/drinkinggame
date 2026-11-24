// Round-side game logic (Phase 3B): Start, answers, Next / Finish, End, the round-end deadline and
// "who is here" consequences (pause, early round end).
//
// This file only decides WHO may do WHAT and WHEN; the transitions live in game/rounds/round.ts,
// the question draw and candidate choice in game/rounds/, the scoring in game/scoring/.
//
// Conventions: MUTATE `draft`, return effects. The engine has already checked sender identity,
// host-only, phase and stale roundId (a late or double Submit / Next never gets here).
import { MIN_PLAYERS, PODIUM_MIN_PLAYERS } from '../../shared/constants';
import type { PlayerId } from '../../shared/protocol';
import { serverAcceptsAdvance } from '../../shared/reveal';
import { acceptsAnswers } from '../../shared/timeline';
import { broadcast, errorTo } from '../effects';
import { activePlayers } from '../players/presence';
import { drawQuestions } from '../rounds/draw';
import { closeRound, closeRoundIfEveryoneReady, endGame, startRound } from '../rounds/round';
import type { GameState, RoundState } from '../stateSchema';
import type { Ctx, Effect, EngineMessageOf, Sender } from '../types';

/**
 * Host starts the game from the LOBBY. Needs ≥ MIN_PLAYERS active players (G-21) — and
 * ≥ PODIUM_MIN_PLAYERS for Podium (G-24: the mode is never switched back by the server; the host
 * sees why Start is disabled) — and a pool that fills the game length (G-23 safety net →
 * NOT_ENOUGH_QUESTIONS). The game stays in the lobby on any refusal. Draws the questions (G-22,
 * G-31), then starts round 1.
 */
export function handleStart(
  draft: GameState,
  _msg: EngineMessageOf<'start'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const active = activePlayers(draft).length;
  if (active < MIN_PLAYERS) return [errorTo(sender.connId, 'NOT_ALLOWED', 'start')];
  if (draft.settings.mode === 'podium' && active < PODIUM_MIN_PLAYERS)
    return [errorTo(sender.connId, 'NOT_ALLOWED', 'start')];
  const questions = drawQuestions(draft.settings.categories, draft.settings.gameLength, ctx.random);
  if (questions === null) return [errorTo(sender.connId, 'NOT_ENOUGH_QUESTIONS', 'start')];
  draft.questions = questions;
  return startRound(draft, ctx, 1);
}

/**
 * A ranking (G-36, G-37). Silently ignored (a double tap, a slow phone) when this player already
 * answered or the answer window is over; refused before the window opens, from someone who isn't
 * taking part (a late joiner, G-19), and when it doesn't fill exactly the round's spots.
 */
export function handleSubmit(
  draft: GameState,
  msg: EngineMessageOf<'submit'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const round = currentRound(draft);
  const playerId = senderId(sender);
  const refuse = (code: 'NOT_ALLOWED' | 'INVALID') => [errorTo(sender.connId, code, 'submit')];

  if (!round.participants.includes(playerId)) return refuse('NOT_ALLOWED');
  if (!acceptsAnswers(ctx.now, round)) {
    // Too early is a bug on the phone; too late is just a slow phone (the alarm closes the round).
    return ctx.now < round.answerStartsAt ? refuse('NOT_ALLOWED') : [];
  }
  if (round.answers[playerId] !== undefined) return []; // final: a second tap changes nothing
  if (!fillsSpots(msg.ranking, round)) return refuse('INVALID');

  round.answers[playerId] = [...msg.ranking];
  return [
    broadcast({ type: 'playerReady', roundId: round.roundId, playerId }),
    ...closeRoundIfEveryoneReady(draft, ctx),
  ];
}

/**
 * The host's Next / Finish (G-45), from the end of the reveal on (with a little clock tolerance;
 * earlier taps are ignored — the phone only unlocks the button when the reveal is done). After the
 * last question it ends the game — also while paused. Otherwise the next round starts, unless the
 * game is paused (G-42): the host's Next works again once enough players are back.
 */
export function handleAdvance(
  draft: GameState,
  _msg: EngineMessageOf<'advance'>,
  sender: Sender,
  ctx: Ctx,
): Effect[] {
  const round = currentRound(draft);
  if (round.results === null) throw new Error('Engine contract broken: advance outside RESULTS');
  if (!serverAcceptsAdvance(ctx.now, round.results.revealEndsAt)) return [];
  if (round.index + 1 >= draft.questions.length) return endGame(draft, ctx, 'finished');
  if (draft.paused) return [errorTo(sender.connId, 'NOT_ALLOWED', 'advance')];
  return startRound(draft, ctx, round.roundId + 1);
}

/** Host ends the game from any phase (G-46). */
export function handleEnd(
  draft: GameState,
  _msg: EngineMessageOf<'end'>,
  _sender: Sender,
  ctx: Ctx,
): Effect[] {
  return endGame(draft, ctx, 'hostEnded');
}

/** Round-end deadline (endsAt + ANSWER_GRACE_MS): close the round, compute results once. */
export function onRoundDeadlines(draft: GameState, ctx: Ctx): Effect[] {
  const due = draft.deadlines.roundEnd;
  if (draft.phase !== 'QUESTION' || due === undefined || due > ctx.now) return [];
  return closeRound(draft, ctx);
}

/**
 * Called by the engine after ANY change to who is online or active (including after a rebuild —
 * its effects are sent like any others). The ONLY place for: setting/clearing the pause flag
 * (G-42, counting late joiners waiting for their first round) and ending the round early because
 * everyone still being waited for has answered (G-39).
 */
export function onPlayersChanged(draft: GameState, ctx: Ctx): Effect[] {
  if (draft.phase !== 'QUESTION' && draft.phase !== 'RESULTS') return [];
  return [...updatePause(draft), ...closeRoundIfEveryoneReady(draft, ctx)];
}

/**
 * G-42: paused while fewer than MIN_PLAYERS are active (late joiners count — otherwise 2 players +
 * 1 late joiner could never continue). The flag only blocks the host's Next; clearing it never
 * starts anything by itself.
 */
function updatePause(draft: GameState): Effect[] {
  const shouldPause = activePlayers(draft).length < MIN_PLAYERS;
  if (shouldPause === draft.paused) return [];
  draft.paused = shouldPause;
  return [broadcast(shouldPause ? { type: 'paused', needed: MIN_PLAYERS } : { type: 'resumed' })];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The running round — the engine guarantees one for round-bound messages. */
function currentRound(draft: GameState): RoundState {
  if (draft.round === null)
    throw new Error('Engine contract broken: round message without a round');
  return draft.round;
}

function senderId(sender: Sender): PlayerId {
  if (sender.playerId === undefined)
    throw new Error('Engine contract broken: player message without a player');
  return sender.playerId;
}

/**
 * The top `round.spots` places, each a different shown player (G-36, G-24) — one rule for both
 * modes: in Spotlight spots = every shown player, in Podium the top 3.
 */
function fillsSpots(ranking: readonly PlayerId[], round: RoundState): boolean {
  return (
    ranking.length === round.spots &&
    new Set(ranking).size === ranking.length &&
    ranking.every((id) => round.candidates.includes(id))
  );
}
