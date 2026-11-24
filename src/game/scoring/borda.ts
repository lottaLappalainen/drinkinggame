// The group ranking of one question (GAME_DESCRIPTION S-1…S-4, S-8): a Borda count.
//
// Each voter fills the top `spots` places (shared/spots.ts): spot 1 earns `spots` points, spot 2
// earns `spots − 1`, … the last spot 1 point; players left unplaced earn 0. Spotlight is the case
// spots = number of candidates (N, N−1, … 1 — S-1); Podium fills 3 spots (3, 2, 1 — S-8). A
// player's score is the sum over all submitted answers. Equal scores share a place and the next
// place is skipped ("1, 1, 3"). Raw points stay inside this module's callers in game/scoring —
// they never leave the server (S-6: points would reveal how people voted).
import type { PlayerId, RankingEntry } from '../../shared/protocol';

/** One submitted ranking: the top `spots` candidates, best first. */
export type Vote = readonly PlayerId[];

/** Points per candidate. Every candidate has an entry (0 if nobody placed them). */
export function bordaPoints(
  candidates: readonly PlayerId[],
  votes: readonly Vote[],
  spots: number,
): Map<PlayerId, number> {
  const points = new Map<PlayerId, number>(candidates.map((id) => [id, 0]));
  for (const vote of votes) {
    vote.forEach((id, index) => {
      points.set(id, (points.get(id) ?? 0) + (spots - index));
    });
  }
  return points;
}

/**
 * Places from points: highest first; players with equal points share a place and the next place
 * is skipped (competition ranking). Ties keep the order of `players` (which the server shuffled
 * per question), so no player is favoured on the list.
 */
export function placesFromPoints(
  players: readonly PlayerId[],
  points: ReadonlyMap<PlayerId, number>,
): RankingEntry[] {
  const score = (id: PlayerId) => points.get(id) ?? 0;
  return players
    .map((playerId) => ({
      playerId,
      // 1 + how many players scored strictly more
      place: 1 + players.filter((other) => score(other) > score(playerId)).length,
    }))
    .sort((a, b) => a.place - b.place); // stable: ties stay in candidate order
}
