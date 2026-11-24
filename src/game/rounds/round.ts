// Round and game transitions (3B). Each function mutates the draft and returns the effects —
// handlers/rounds.ts only checks who may do what and then calls these.
import { ENDED_RETENTION_MS, QUESTION_INTRO_MS, ROUND_MS } from '../../shared/constants';
import type { EndReason, RoundResults } from '../../shared/protocol';
import { canEndEarly, readyCounter } from '../../shared/ready';
import { isPartialRanking, spotsFor } from '../../shared/spots';
import { roundCloseDeadline } from '../../shared/timeline';
import { broadcast } from '../effects';
import { entriesOf, keysOf } from '../ids';
import { denyReclaim } from '../players/reclaims';
import { publicRound } from '../players/view';
import { computeResults } from '../scoring/results';
import type { GameState, RoundState } from '../stateSchema';
import type { Ctx, Effect } from '../types';
import { hasSubject } from '../../shared/questionSubject';
import { roundParticipants, selectCandidates } from './candidates';
import { pickSubject, settleSubjectQuestion } from './subject';

/**
 * Start round `roundId` (1-based; it shows question `roundId − 1` of the drawn list): fix who takes
 * part and who is ranked, then the timeline — intro (question only, G-49), then the answer window
 * (G-40) counted from `answerStartsAt`. The round-end deadline includes the answer grace (G-39).
 * A "[player]" question gets its subject here and leaves them off the list to rank (G-51).
 */
export function startRound(draft: GameState, ctx: Ctx, roundId: number): Effect[] {
  const participants = roundParticipants(draft, roundId);
  const leaveSubjectOut = settleSubjectQuestion(draft, roundId - 1, participants.length);
  const question = draft.questions[roundId - 1];
  const subjectId =
    question !== undefined && hasSubject(question.text)
      ? pickSubject(draft, participants, ctx.random)
      : null;
  const rankable = leaveSubjectOut ? participants.filter((id) => id !== subjectId) : participants;
  const candidates = selectCandidates(draft, rankable, ctx.random);
  for (const id of candidates) {
    const player = draft.players[id];
    if (player) player.timesShown += 1;
  }
  const subject = subjectId === null ? undefined : draft.players[subjectId];
  if (subject) subject.timesSubject += 1;
  const answerStartsAt = ctx.now + QUESTION_INTRO_MS;
  const round: RoundState = {
    roundId,
    index: roundId - 1,
    candidates,
    spots: spotsFor(draft.settings.mode, candidates.length),
    participants,
    startedAt: ctx.now,
    answerStartsAt,
    endsAt: answerStartsAt + ROUND_MS,
    answers: {},
    results: null,
    subjectId,
  };
  draft.phase = 'QUESTION';
  draft.round = round;
  draft.deadlines.roundEnd = roundCloseDeadline(round);
  // Late joiners that are now participants stop "waiting" — phones see that from the participants.
  return [broadcast({ type: 'roundStarted', round: publicRound(draft, round) })];
}

/**
 * QUESTION → RESULTS, exactly once (a second call finds the results already there and does
 * nothing): Borda places, reveal steps, stats (S-1…S-7, G-50), then sends roundResults.
 */
export function closeRound(draft: GameState, ctx: Ctx): Effect[] {
  const round = draft.round;
  if (draft.phase !== 'QUESTION' || round === null || round.results !== null) return [];
  const results = computeResults({
    roundId: round.roundId,
    candidates: round.candidates,
    spots: round.spots,
    answers: round.answers,
    now: ctx.now,
    random: ctx.random,
  });
  round.results = results;
  draft.phase = 'RESULTS';
  delete draft.deadlines.roundEnd;
  recordStats(draft, round, results);
  return [broadcast({ type: 'roundResults', results })];
}

/**
 * Close the round now if everyone being waited for has answered (G-39): the ready counter is full,
 * answering has started and someone is being waited for (so phones locking during the intro don't
 * end the round at "0 / 0"). Called after every submit and every change of who is online or active.
 */
export function closeRoundIfEveryoneReady(draft: GameState, ctx: Ctx): Effect[] {
  const round = draft.round;
  if (draft.phase !== 'QUESTION' || round === null || round.results !== null) return [];
  const counter = readyCounter(
    round.participants,
    new Set(keysOf(round.answers)),
    (id) => draft.players[id]?.connId != null,
  );
  return canEndEarly(ctx.now, round.answerStartsAt, counter) ? closeRound(draft, ctx) : [];
}

/**
 * Game over (G-45 Finish, G-46 End): the game is kept for ENDED_RETENTION_MS so phones that
 * reconnect late still see the Game Over screen (G-48). Answers are dropped with the round, and
 * "That's me" requests nobody can answer any more are denied.
 */
export function endGame(
  draft: GameState,
  ctx: Ctx,
  reason: Exclude<EndReason, 'updated'>,
): Effect[] {
  draft.phase = 'ENDED';
  draft.endReason = reason;
  draft.paused = false;
  draft.round = null;
  delete draft.deadlines.roundEnd;
  delete draft.deadlines.hostHandover;
  draft.deadlines.retention = ctx.now + ENDED_RETENTION_MS;

  const effects: Effect[] = [broadcast({ type: 'gameEnded', reason, summary: null })];
  for (const [requestId, request] of entriesOf(draft.reclaims)) {
    if (request.status === 'pending') effects.push(...denyReclaim(draft, requestId));
  }
  return effects;
}

/**
 * Per-player counters for the Game Over summary (§5.4): answered / missed per participant;
 * timesFirst / timesLast from the group ranking (if everyone is tied at place 1, or the ranking is
 * partial (Podium), nobody is "last"); sips drunk / given from the reveal steps' rules (D-9).
 */
function recordStats(draft: GameState, round: RoundState, results: RoundResults): void {
  for (const id of round.participants) {
    const player = draft.players[id];
    if (!player) continue;
    if (round.answers[id] !== undefined) player.stats.answered += 1;
    else player.stats.missed += 1;
  }
  if (results.outcome !== 'ranked') return;
  // In a partial ranking the last place is the "No votes" group — nobody is "last" there (G-50).
  const partial = isPartialRanking(round.spots, round.candidates.length);
  const lastPlace = Math.max(...results.ranking.map((entry) => entry.place));
  for (const { playerId, place } of results.ranking) {
    const player = draft.players[playerId];
    if (!player) continue;
    if (place === 1) player.stats.timesFirst += 1;
    if (!partial && place === lastPlace && lastPlace > 1) player.stats.timesLast += 1;
  }
  for (const step of results.steps) {
    if (step.rule === null) continue;
    for (const playerId of step.playerIds) {
      const player = draft.players[playerId];
      if (!player) continue;
      if (step.rule.action === 'drink') player.stats.sipsDrunk += step.rule.sips;
      else player.stats.sipsGiven += step.rule.sips;
    }
  }
}
