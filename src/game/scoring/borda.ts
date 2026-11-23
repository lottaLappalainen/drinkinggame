// The group ranking of one question (GAME_DESCRIPTION S-1…S-4): a Borda count.
//
// With N players shown, a vote gives N points to spot 1, N−1 to spot 2, … 1 point to the last spot;
// a player's score is the sum over all submitted answers. Equal scores share a place and the next
// place is skipped ("1, 1, 3"). Raw points stay inside this module — they never leave the server
// (S-6: points would reveal how people voted); callers only get places.
import type { PlayerId, RankingEntry } from '../../shared/protocol';

/** One submitted ranking: the candidates, best first. */
export type Vote = readonly PlayerId[];

/** Points per candidate. Every candidate has an entry (0 if there are no votes). */
export function bordaPoints(
  candidates: readonly PlayerId[],
  votes: readonly Vote[],
): Map<PlayerId, number> {
  const points = new Map<PlayerId, number>(candidates.map((id) => [id, 0]));
  const spots = candidates.length;
  for (const vote of votes) {
    vote.forEach((id, index) => {
      points.set(id, (points.get(id) ?? 0) + (spots - index));
    });
  }
  return points;
}

/**
 * Places from points: highest first; players with equal points share a place and the next place
 * is skipped (competition ranking). Ties keep the order of `candidates` (which the server shuffled
 * per question), so no player is favoured on the list.
 */
export function placesFromPoints(
  candidates: readonly PlayerId[],
  points: ReadonlyMap<PlayerId, number>,
): RankingEntry[] {
  const score = (id: PlayerId) => points.get(id) ?? 0;
  return candidates
    .map((playerId) => ({
      playerId,
      // 1 + how many players scored strictly more
      place: 1 + candidates.filter((other) => score(other) > score(playerId)).length,
    }))
    .sort((a, b) => a.place - b.place); // stable: ties stay in candidate order
}

/** Average spot (1 = always first) per candidate, rounded to 2 decimals. */
export function averageSpots(
  candidates: readonly PlayerId[],
  votes: readonly Vote[],
): Map<PlayerId, number> {
  const result = new Map<PlayerId, number>();
  for (const id of candidates) {
    const spots = votes.map((vote) => vote.indexOf(id) + 1);
    const mean = spots.reduce((sum, spot) => sum + spot, 0) / Math.max(spots.length, 1);
    result.set(id, Math.round(mean * 100) / 100);
  }
  return result;
}

/** How many votes put each candidate in spot 1. */
export function firstVotes(
  candidates: readonly PlayerId[],
  votes: readonly Vote[],
): Map<PlayerId, number> {
  return new Map(
    candidates.map((id) => [id, votes.filter((vote) => vote[0] === id).length] as const),
  );
}
