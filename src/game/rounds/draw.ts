// The question draw at Start (G-22, G-31): `gameLength` distinct questions from Default plus the
// chosen add-ons, fixed for the whole game.
//
// One shuffle of the pool, first N taken — so a repeat is impossible by construction, and every
// question in the pool is equally likely (a category with more questions appears more often; no
// quotas — decided 2026-11-24).
//
// "Play again" (G-52): questions the group already played in this game object are drawn only once
// the unplayed ones run out — then the game is topped up with played ones, mixed in at random.
import type { Question } from '../../shared/protocol';
import type { AddOnCategoryId } from '../../shared/questionCategories';
import { QUESTION_BANK, questionPool } from '../questions';
import { shuffle } from './shuffle';

/**
 * The game's questions, or null if the pool can't fill `gameLength` (G-23 safety net — the bank
 * test guarantees enough Default questions; the caller answers NOT_ENOUGH_QUESTIONS). Copies the
 * questions: the game never reads the bank again. `played` = ids this group has already had.
 */
export function drawQuestions(
  addOns: readonly AddOnCategoryId[],
  gameLength: number,
  random: () => number,
  options: { readonly played?: readonly string[]; readonly bank?: readonly Question[] } = {},
): Question[] | null {
  const pool = questionPool(addOns, options.bank ?? QUESTION_BANK);
  if (pool.length < gameLength) return null;
  const played = new Set(options.played ?? []);
  const fresh = shuffle(
    pool.filter((question) => !played.has(question.id)),
    random,
  );
  const drawn =
    fresh.length >= gameLength
      ? fresh.slice(0, gameLength)
      : shuffle(
          [
            ...fresh,
            ...shuffle(
              pool.filter((question) => played.has(question.id)),
              random,
            ).slice(0, gameLength - fresh.length),
          ],
          random,
        );
  return drawn.map((question) => ({ ...question }));
}
