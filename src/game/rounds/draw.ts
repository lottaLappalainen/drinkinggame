// The question draw at Start (G-22, G-31): `gameLength` distinct questions from the chosen
// categories, fixed for the whole game.
//
// One shuffle of the pool, first N taken — so a repeat is impossible by construction, and every
// question in the pool is equally likely (a category with more questions appears more often).
// If a group should instead get an equal share per category (U7, PLAN.md), only this function changes.
import type { Question } from '../../shared/protocol';
import type { CategoryId } from '../../shared/questionCategories';
import { QUESTION_BANK, questionPool } from '../questions';
import { shuffle } from './shuffle';

/**
 * The game's questions, or null if the chosen categories can't fill `gameLength` (G-23 — the
 * caller answers NOT_ENOUGH_QUESTIONS). Copies the questions: the game never reads the bank again.
 */
export function drawQuestions(
  categories: readonly CategoryId[],
  gameLength: number,
  random: () => number,
  bank: readonly Question[] = QUESTION_BANK,
): Question[] | null {
  const pool = questionPool(categories, bank);
  if (pool.length < gameLength) return null;
  return shuffle(pool, random)
    .slice(0, gameLength)
    .map((question) => ({ ...question }));
}
