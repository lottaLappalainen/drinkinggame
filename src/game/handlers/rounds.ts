// Round-side game logic (Phase 3B): Start, answers, Next / Finish, End, Play again, the round-end deadline and
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
import {
  closeRound,
  closeRoundIfEveryoneReady,
  endGame,
  reopenLobby,
  startRound,
} from '../rounds/round';
import type { GameState, RoundState } from '../stateSchema';
import type { Ctx, Effect, EngineMessageOf, PlayerSender } from '../types';

/**
 * Host starts the game from the LOBBY. Needs ≥ MIN_PLAYERS active players (G-21) — and
 * ≥ PODIUM_MIN_PLAYERS for Podium (G-24: the mode is never switched back by the server; the host
 * sees why Start is disabled) — and a pool that fills the game length (G-23 safety net →
 * NOT_ENOUGH_QUESTIONS). The game stays in the lobby on any refusal; too few players is
 * NOT_ENOUGH_PLAYERS, so the phone can say why (someone may have left just as the host tapped). Draws the questions (G-22,
 * G-31), then starts round 1.
 */
export function handleStart(
  draft: GameState,
  _msg: EngineMessageOf<'start'>,
  sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  const active = activePlayers(draft).length;
  const needed = draft.settings.mode === 'podium' ? PODIUM_MIN_PLAYERS : MIN_PLAYERS;
  if (active < needed) return [errorTo(sender.connId, 'NOT_ENOUGH_PLAYERS', 'start')];
  const questions = drawQuestions(
    draft.settings.categories,
    draft.settings.gameLength,
    ctx.random,
    {
      played: draft.playedQuestionIds,
    },
  );
  if (questions === null) return [errorTo(sender.connId, 'NOT_ENOUGH_QUESTIONS', 'start')];
  draft.questions = questions;
  return startRound(draft, ctx, 1);
}

/**
 * A ranking (G-36, G-37). Silently ignored (a double tap, a slow phone) when this player already
 * answered or the answer window is over; refused before the window opens (TOO_EARLY: the phone's
 * clock runs ahead — it may simply send again), from someone who isn't
 * taking part (a late joiner, G-19), and when it doesn't fill exactly the round's spots.
 */
export function handleSubmit(
  draft: GameState,
  msg: EngineMessageOf<'submit'>,
  sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  const round = currentRound(draft);
  const { playerId } = sender;
  const refuse = (code: 'NOT_ALLOWED' | 'INVALID' | 'TOO_EARLY') => [
    errorTo(sender.connId, code, 'submit'),
  ];

  if (!round.participants.includes(playerId)) return refuse('NOT_ALLOWED');
  if (!acceptsAnswers(ctx.now, round)) {
    // Too early: the phone's clock is ahead. Too late: just a slow phone (the round closes anyway).
    return ctx.now < round.answerStartsAt ? refuse('TOO_EARLY') : [];
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
 * The host's Next / Finish (G-45), from the end of the reveal on (with a little clock tolerance).
 * Earlier → TOO_EARLY: the phone unlocks the button by its synced clock, so this only happens with
 * a clock that is off — the phone re-enables the button instead of waiting for a round that never
 * comes. After the last question it ends the game — also while paused. Otherwise the next round
 * starts, unless the game is paused (G-42 → PAUSED): Next works again once enough players are back.
 */
export function handleAdvance(
  draft: GameState,
  _msg: EngineMessageOf<'advance'>,
  sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  const round = currentRound(draft);
  if (round.results === null) throw new Error('Engine contract broken: advance outside RESULTS');
  if (!serverAcceptsAdvance(ctx.now, round.results.revealEndsAt))
    return [errorTo(sender.connId, 'TOO_EARLY', 'advance')];
  if (round.index + 1 >= draft.questions.length) return endGame(draft, ctx, 'finished');
  if (draft.paused) return [errorTo(sender.connId, 'PAUSED', 'advance')];
  return startRound(draft, ctx, round.roundId + 1);
}

/** Host ends the game from any phase (G-46). */
export function handleEnd(
  draft: GameState,
  _msg: EngineMessageOf<'end'>,
  _sender: PlayerSender,
  ctx: Ctx,
): Effect[] {
  return endGame(draft, ctx, 'hostEnded');
}

/**
 * Host taps "Play again" on Game Over (G-52): the same group goes back to a fresh lobby. Not after
 * an 'updated' end: that game was replaced by an empty one, with no players to bring along (it has
 * no host either, so the host-only rule already stops it — this check keeps the reason explicit).
 */
export function handlePlayAgain(
  draft: GameState,
  _msg: EngineMessageOf<'playAgain'>,
  sender: PlayerSender,
): Effect[] {
  if (draft.endReason === 'updated') return [errorTo(sender.connId, 'NOT_ALLOWED', 'playAgain')];
  return reopenLobby(draft);
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
