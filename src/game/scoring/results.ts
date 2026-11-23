// A round's results (S-1…S-7), computed exactly once when the round closes.
//
// outcome 'nobodyAnswered'  — 0 answers (S-5)
// outcome 'notEnoughAnswers' — fewer than MIN_ANSWERS_FOR_RANKING (S-7): with one answer the
//                              "group ranking" would just be that person's ranking
// outcome 'ranked'           — places, reveal steps, and stats only with ≥ MIN_ANSWERS_FOR_STATS (S-6)
import {
  MIN_ANSWERS_FOR_RANKING,
  MIN_ANSWERS_FOR_STATS,
  REVEAL_BUFFER_MS,
} from '../../shared/constants';
import type { PlayerId, PlayerStats, RoundResults } from '../../shared/protocol';
import { revealEndsAt as revealEnd } from '../../shared/reveal';
import { averageSpots, bordaPoints, firstVotes, placesFromPoints, type Vote } from './borda';
import { revealSteps } from './revealSteps';

export type ResultsInput = {
  readonly roundId: number;
  readonly candidates: readonly PlayerId[];
  /** Everything that was submitted: who → their ranking. Never leaves the server. */
  readonly answers: Readonly<Record<string, readonly PlayerId[]>>;
  /** The moment the round closes; the reveal starts REVEAL_BUFFER_MS later so every phone has it. */
  readonly now: number;
};

export function computeResults(input: ResultsInput): RoundResults {
  const votes: Vote[] = Object.values(input.answers);
  const answerCount = votes.length;
  const revealStartsAt = input.now + REVEAL_BUFFER_MS;
  const common = { roundId: input.roundId, answerCount, revealStartsAt };

  if (answerCount === 0) {
    return { ...common, outcome: 'nobodyAnswered', revealEndsAt: revealStartsAt };
  }
  if (answerCount < MIN_ANSWERS_FOR_RANKING) {
    return { ...common, outcome: 'notEnoughAnswers', revealEndsAt: revealStartsAt };
  }

  const ranking = placesFromPoints(input.candidates, bordaPoints(input.candidates, votes));
  const steps = revealSteps(ranking);
  return {
    ...common,
    outcome: 'ranked',
    revealEndsAt: revealEnd(revealStartsAt, steps.length),
    ranking,
    steps,
    stats: answerCount >= MIN_ANSWERS_FOR_STATS ? playerStats(input.candidates, votes) : null,
  };
}

/** Per-player numbers that stay safe to show with ≥ MIN_ANSWERS_FOR_STATS voters (S-6). */
function playerStats(candidates: readonly PlayerId[], votes: readonly Vote[]): PlayerStats[] {
  const spots = averageSpots(candidates, votes);
  const firsts = firstVotes(candidates, votes);
  return candidates.map((playerId) => ({
    playerId,
    averageSpot: spots.get(playerId) ?? candidates.length,
    firstVotes: firsts.get(playerId) ?? 0,
  }));
}
