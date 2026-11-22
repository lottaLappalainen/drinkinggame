// The question bank (Q-1…Q-6). Written by the user; the agent maintains only the format, this
// validation and clearly marked placeholders. Imported by the server only — never the client (G-33).
import * as v from 'valibot';
import { MIN_QUESTION_BANK_SIZE } from '../shared/constants';
import { QuestionSchema, type Question } from '../shared/protocol';
import rawBank from '../questions/questions.json';

export const QuestionBankSchema = v.pipe(
  v.array(QuestionSchema),
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
  | { readonly kind: 'duplicateText'; readonly ids: readonly [string, string] };

/** Problems the schema can't express: duplicate ids and duplicate (normalized) texts. */
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
  }
  return problems;
}

/** The validated bank. Throws at load time if the file is malformed — a broken bank must never ship. */
export const QUESTION_BANK: readonly Question[] = v.parse(QuestionBankSchema, rawBank);

const BY_ID = new Map(QUESTION_BANK.map((question) => [question.id, question]));

export function getQuestion(id: string): Question | undefined {
  return BY_ID.get(id);
}
