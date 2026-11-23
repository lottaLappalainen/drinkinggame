// Who answers and who is ranked in a round (G-15, G-34, G-35).
import { CANDIDATES_WHEN_MORE, SHOW_ALL_UP_TO } from '../../shared/constants';
import type { PlayerId } from '../../shared/protocol';
import { entriesOf } from '../ids';
import type { GameState } from '../stateSchema';
import { shuffle } from './shuffle';

/**
 * Everyone who takes part in round `roundId`: active players whose first round it is or was
 * (late joiners wait until the next question, G-15). Offline players are included — phones go
 * offline whenever a screen locks, so "online only" would make the selection jump around (G-34).
 * In join order.
 */
export function roundParticipants(state: GameState, roundId: number): PlayerId[] {
  return entriesOf(state.players)
    .filter(([, player]) => player.status === 'active' && player.activeFromRound <= roundId)
    .map(([id]) => id);
}

/**
 * The players to rank (G-34): all of them while there are at most SHOW_ALL_UP_TO; with more,
 * exactly CANDIDATES_WHEN_MORE, the least-shown first with random ties (G-35) — so over a game
 * everyone appears about equally. (6 players → all 6, 7 players → 5: the drop is the rule, not a bug.)
 *
 * The returned ORDER is random too, so nobody is favoured by their place in the list. Does not
 * touch `timesShown` — the caller counts a candidate as shown once the round starts.
 */
export function selectCandidates(
  state: GameState,
  participants: readonly PlayerId[],
  random: () => number,
): PlayerId[] {
  const pool = shuffle([...participants], random);
  if (pool.length <= SHOW_ALL_UP_TO) return pool;
  const timesShown = (id: PlayerId) => state.players[id]?.timesShown ?? 0;
  // The pool is already in random order and sort() is stable, so equal counts stay random.
  const fairest = pool.sort((a, b) => timesShown(a) - timesShown(b)).slice(0, CANDIDATES_WHEN_MORE);
  return shuffle(fairest, random);
}
