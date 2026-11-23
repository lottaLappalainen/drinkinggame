// The question bank (Q-1…Q-9). Written by the user; the agent maintains only the format, this
// validation and clearly marked placeholders. Imported by the server only — never the client (G-33).
import * as v from 'valibot';
import { MIN_QUESTION_BANK_SIZE, QUESTION_MAX_LENGTH } from '../shared/constants';
import {
  CategoryIdSchema,
  LabelSetIdSchema,
  type Question,
  type QuestionCounts,
} from '../shared/protocol';
import type { CategoryId } from '../shared/questionCategories';
import { DEFAULT_LABEL_SET, labelMismatch } from '../shared/questionLabels';
import rawBank from '../questions/questions.json';

/**
 * One entry of questions.json. `labels` may be left out for "most likely" questions (Q-8); the
 * loaded bank always has it, so games and phones never deal with a missing label set.
 */
export const BankQuestionSchema = v.strictObject({
  id: v.pipe(v.string(), v.minLength(1)),
  text: v.pipe(v.string(), v.minLength(1), v.maxLength(QUESTION_MAX_LENGTH)),
  category: CategoryIdSchema,
  labels: v.optional(LabelSetIdSchema, DEFAULT_LABEL_SET),
});

export const QuestionBankSchema = v.pipe(
  v.array(BankQuestionSchema),
  v.minLength(
    MIN_QUESTION_BANK_SIZE,
    `The bank needs at least ${MIN_QUESTION_BANK_SIZE} questions (G-32)`,
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

/** Questions in the chosen categories (G-22) — what a game's draw picks from. */
export function questionPool(
  categories: readonly CategoryId[],
  bank: readonly Question[] = QUESTION_BANK,
): Question[] {
  return bank.filter((question) => categories.includes(question.category));
}

/** Questions per category, for the lobby chips and G-23 (counts only, never texts — G-33). */
export function questionCounts(bank: readonly Question[] = QUESTION_BANK): QuestionCounts {
  const counts: QuestionCounts = { mild: 0, spicy: 0, personal: 0 };
  for (const question of bank) counts[question.category] += 1;
  return counts;
}

/** G-23: can the chosen categories fill a game of this length? */
export function poolCanFill(
  categories: readonly CategoryId[],
  gameLength: number,
  counts: QuestionCounts = QUESTION_COUNTS,
): boolean {
  return categories.reduce((sum, id) => sum + counts[id], 0) >= gameLength;
}

/** Computed once: the bank never changes while the code runs. */
export const QUESTION_COUNTS: QuestionCounts = questionCounts();
