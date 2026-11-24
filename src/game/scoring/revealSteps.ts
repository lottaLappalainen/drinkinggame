// The reveal steps (G-50) from the group ranking — computed on the server, once.
//
// Steps are named by POSITION (`bottom`, `third`, `second`, `top`), never by wording: the words
// ("Least likely" / "Least", …) come from the question's label set on the phone (shared/questionLabels
// `placeLabel`), so the same steps fit every question.
//
// Order: bottom → third → second → top ("least" first, the biggest moment last). Rules:
// - `top` = the players at place 1 (ties are revealed together, S-4).
// - `bottom` = the players at the LAST place — only if that isn't place 1 (everyone tied → one
//   step), and only in a FULL ranking: when some players are unplaced (Podium, G-24) the bottom is
//   the "No votes" group, which is never revealed (`withBottom = false`).
// - `second` / `third` = the players at place 2 / 3 — only if that place exists (a tie skips it:
//   "1, 1, 3" has no 2nd step) and isn't already the bottom step (3 players: the 3rd IS the bottom).
// - Places between 3rd and the last are never revealed one by one; the full ranking follows.
import type { RankingEntry, RevealStep } from '../../shared/protocol';

export function revealSteps(ranking: readonly RankingEntry[], withBottom = true): RevealStep[] {
  const places = [...new Set(ranking.map((entry) => entry.place))].sort((a, b) => a - b);
  const lastPlace = places[places.length - 1];
  if (lastPlace === undefined) return []; // no ranking, nothing to reveal
  const bottom = withBottom && lastPlace > 1 ? lastPlace : null;

  const group = (place: number) =>
    ranking.filter((entry) => entry.place === place).map((entry) => entry.playerId);
  const step = (kind: RevealStep['kind'], place: number): RevealStep[] => {
    const playerIds = group(place);
    return playerIds.length === 0 ? [] : [{ kind, place, playerIds, rule: null }];
  };

  return [
    ...(bottom !== null ? step('bottom', bottom) : []),
    ...(bottom !== 3 ? step('third', 3) : []),
    ...(bottom !== 2 ? step('second', 2) : []),
    ...step('top', 1),
  ];
}
