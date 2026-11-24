// The question draw at Start (G-22, G-31): `gameLength` distinct questions from Default plus the
// chosen add-ons, fixed for the whole game.
//
// One shuffle of the pool, first N taken — so a repeat is impossible by construction, and every
// question in the pool is equally likely (a category with more questions appears more often; no
// quotas — decided 2026-11-24).
import type { Question } from '../../shared/protocol';
import type { AddOnCategoryId } from '../../shared/questionCategories';
import { QUESTION_BANK, questionPool } from '../questions';
import { shuffle } from './shuffle';

/**
 * The game's questions, or null if the pool can't fill `gameLength` (G-23 safety net — the bank
 * test guarantees enough Default questions; the caller answers NOT_ENOUGH_QUESTIONS). Copies the questions: the game never reads the bank again.
 */
export function drawQuestions(
  addOns: readonly AddOnCategoryId[],
  gameLength: number,
  random: () => number,
  bank: readonly Question[] = QUESTION_BANK,
): Question[] | null {
  const pool = questionPool(addOns, bank);
  if (pool.length < gameLength) return null;
  return shuffle(pool, random)
    .slice(0, gameLength)
    .map((question) => ({ ...question }));
}
