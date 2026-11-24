// Questions about a player (G-51, Q-10): "Who is the closest to [player]?". The server picks the
// player (the "subject") when the round starts; the subject is left off the list to rank.
import { SUBJECT_MIN_RANKABLE } from '../../shared/constants';
import type { PlayerId } from '../../shared/protocol';
import { hasSubject } from '../../shared/questionSubject';
import type { GameState } from '../stateSchema';
import { shuffle } from './shuffle';

/**
 * With fewer than SUBJECT_MIN_RANKABLE rankable players, leaving the subject out would leave only
 * 2 to rank: the "[player]" question at `index` then swaps places with the next regular question
 * later in the game's list (still drawn once at Start, still no repeats — phones never see the list
 * in advance). Returns whether the question now at `index` leaves its subject off the list: false
 * for a regular question, and for the fallback when no regular question is left (the subject is
 * then ranked too).
 */
export function settleSubjectQuestion(
  draft: GameState,
  index: number,
  rankableCount: number,
): boolean {
  const question = draft.questions[index];
  if (question === undefined || !hasSubject(question.text)) return false;
  if (rankableCount >= SUBJECT_MIN_RANKABLE) return true;
  const later = draft.questions.findIndex((other, i) => i > index && !hasSubject(other.text));
  const regular = draft.questions[later];
  if (regular !== undefined) {
    draft.questions[index] = regular;
    draft.questions[later] = question;
  }
  return false;
}

/**
 * The subject: one of the round's participants (the rankable players, G-34 — online or offline),
 * whoever has been the subject least so far, ties random — like the fair candidate choice (G-35).
 */
export function pickSubject(
  draft: GameState,
  participants: readonly PlayerId[],
  random: () => number,
): PlayerId | null {
  const timesSubject = (id: PlayerId) => draft.players[id]?.timesSubject ?? 0;
  // Shuffled first and sort() is stable, so equal counts stay random.
  const [fairest] = shuffle([...participants], random).sort(
    (a, b) => timesSubject(a) - timesSubject(b),
  );
  return fairest ?? null;
}
