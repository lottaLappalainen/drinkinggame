// The question bank (Q-1…Q-9). Written by the user; the agent maintains only the format, this
// validation and clearly marked placeholders. Imported by the server only — never the client (G-33).
import * as v from 'valibot';
import { MIN_QUESTION_BANK_SIZE, QUESTION_MAX_LENGTH } from '../shared/constants';
import { CategoryIdSchema, LabelSetIdSchema, type Question } from '../shared/protocol';
import {
  ALWAYS_ON_CATEGORY,
  CATEGORY_IDS,
  gameCategories,
  type AddOnCategoryId,
  type CategoryId,
} from '../shared/questionCategories';
import { DEFAULT_LABEL_SET, labelMismatch } from '../shared/questionLabels';
import { SUBJECT_TOKEN, bracketTokens } from '../shared/questionSubject';
import rawBank from '../questions/questions.json';

/**
 * One entry of questions.json. `labels` may be left out for "most likely" questions (Q-8); the
 * loaded bank always has it, so games and phones never deal with a missing label set.
 */
export const BankQuestionSchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1)),
  text: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(QUESTION_MAX_LENGTH),
    // Q-10: "[player]" at most once, and no other [...] token (a typo would show up on screen).
    v.check((text) => {
      const tokens = bracketTokens(text);
      return tokens.length === 0 || (tokens.length === 1 && tokens[0] === SUBJECT_TOKEN);
    }, `Only one "${SUBJECT_TOKEN}" and no other [...] tokens are allowed (Q-10)`),
  ),
  category: CategoryIdSchema,
  labels: v.optional(LabelSetIdSchema, DEFAULT_LABEL_SET),
});

/**
 * The always-on Default category alone must fill the longest game (G-23, G-32): then every length
 * works with every add-on selection, and the lobby never has to disable a length.
 */
export const QuestionBankSchema = v.pipe(
  v.array(BankQuestionSchema),
  v.check(
    (bank) =>
      bank.filter((question) => question.category === ALWAYS_ON_CATEGORY).length >=
      MIN_QUESTION_BANK_SIZE,
    `The bank needs at least ${MIN_QUESTION_BANK_SIZE} "${ALWAYS_ON_CATEGORY}" questions (G-32)`,
  ),
);

/** Comparison key for duplicate detection: ignores case, punctuation and spacing (Q-4). */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type BankProblem =
  | { readonly kind: 'duplicateId'; readonly id: string }
  | { readonly kind: 'duplicateText'; readonly ids: readonly [string, string] }
  | { readonly kind: 'labelMismatch'; readonly id: string; readonly reason: string };

/**
 * Problems the schema can't express: duplicate ids, duplicate (normalized) texts, and a text that
 * obviously disagrees with its label set (Q-9).
 */
export function findBankProblems(bank: readonly Question[]): BankProblem[] {
  const problems: BankProblem[] = [];
  const ids = new Set<string>();
  const texts = new Map<string, string>();
  for (const question of bank) {
    if (ids.has(question.id)) problems.push({ kind: 'duplicateId', id: question.id });
    ids.add(question.id);
    const key = normalizeQuestionText(question.text);
    const earlier = texts.get(key);
    if (earlier !== undefined)
      problems.push({ kind: 'duplicateText', ids: [earlier, question.id] });
    else texts.set(key, question.id);
    const mismatch = labelMismatch(question.text, question.labels);
    if (mismatch !== null)
      problems.push({ kind: 'labelMismatch', id: question.id, reason: mismatch });
  }
  return problems;
}

/** The validated bank. Throws at load time if the file is malformed — a broken bank must never ship. */
export const QUESTION_BANK: readonly Question[] = v.parse(QuestionBankSchema, rawBank);

const BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id);
}

/**
 * What a game's draw picks from (G-22): every Default question plus those of the chosen add-ons.
 * No quotas — each question in the pool is equally likely (G-31).
 */
export function questionPool(
  addOns: readonly AddOnCategoryId[],
  bank: readonly Question[] = QUESTION_BANK,
): Question[] {
  const categories: readonly CategoryId[] = gameCategories(addOns);
  return bank.filter((question) => categories.includes(question.category));
}

/** Questions per category (tests and tooling — phones don't need counts any more, G-22). */
export function questionCounts(
  bank: readonly Question[] = QUESTION_BANK,
): Record<CategoryId, number> {
  const counts = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<
    CategoryId,
    number
  >; // safe: one entry per CategoryId, built from the list that defines the type
  for (const question of bank) counts[question.category] += 1;
  return counts;
}
