// A round's results (S-1…S-8), computed exactly once when the round closes.
//
// outcome 'nobodyAnswered'  — 0 answers (S-5)
// outcome 'notEnoughAnswers' — fewer than MIN_ANSWERS_FOR_RANKING (S-7): with one answer the
//                              "group ranking" would just be that person's ranking
// outcome 'ranked'           — places and reveal steps. PLACES ONLY: no points, no vote counts and
//                              no average spot ever leave the server (S-6).
//
// A partial ranking (fewer spots than shown players — Podium, G-24): players nobody placed form the
// "No votes" group, there is no bottom step, and with fewer than MIN_ANSWERS_FOR_NO_VOTES_LIST
// answers only the revealed places are sent (S-8: who got points would give away who picked whom).
import {
  MIN_ANSWERS_FOR_NO_VOTES_LIST,
  MIN_ANSWERS_FOR_RANKING,
  REVEAL_BUFFER_MS,
} from '../../shared/constants';
import type { PlayerId, RoundResults } from '../../shared/protocol';
import { revealEndsAt as revealEnd } from '../../shared/reveal';
import { isPartialRanking } from '../../shared/spots';
import { bordaPoints, placesFromPoints, type Vote } from './borda';
import { revealSteps } from './revealSteps';

export type ResultsInput = {
  readonly roundId: number;
  readonly candidates: readonly PlayerId[];
  /** Places each voter filled (round.spots). */
  readonly spots: number;
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

  const partial = isPartialRanking(input.spots, input.candidates.length);
  const points = bordaPoints(input.candidates, votes, input.spots);
  const hasPoints = (id: PlayerId) => (points.get(id) ?? 0) > 0;
  // In a full ranking every vote gives every candidate ≥ 1 point, so `placed` is everyone.
  const placed = input.candidates.filter(hasPoints);
  const ranking = placesFromPoints(placed, points);
  const steps = revealSteps(ranking, !partial);
  const withhold = partial && answerCount < MIN_ANSWERS_FOR_NO_VOTES_LIST;
  const revealed = new Set(steps.flatMap((step) => step.playerIds));
  return {
    ...common,
    outcome: 'ranked',
    revealEndsAt: revealEnd(revealStartsAt, steps.length),
    ranking: withhold ? ranking.filter((entry) => revealed.has(entry.playerId)) : ranking,
    noVotes: withhold ? null : input.candidates.filter((id) => !hasPoints(id)),
    steps,
  };
}
