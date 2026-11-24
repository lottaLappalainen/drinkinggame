// Q-4: the bank must always be valid — this test guards the user's question file too.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  BankQuestionSchema,
  QUESTION_BANK,
  QuestionBankSchema,
  findBankProblems,
  getQuestion,
  normalizeQuestionText,
  questionCounts,
  questionPool,
} from '../../src/game/questions';
import { CATEGORY_IDS } from '../../src/shared/questionCategories';
import { LABEL_SET_IDS } from '../../src/shared/questionLabels';
import {
  GAME_LENGTHS,
  MIN_QUESTION_BANK_SIZE,
  QUESTION_MAX_LENGTH,
} from '../../src/shared/constants';

describe('question bank (Q-1…Q-4, G-32)', () => {
  it(`has at least ${MIN_QUESTION_BANK_SIZE} Default questions — the longest game, with no add-ons (G-23, G-32)`, () => {
    expect(MIN_QUESTION_BANK_SIZE).toBeGreaterThanOrEqual(Math.max(...GAME_LENGTHS));
    expect(questionCounts().default).toBeGreaterThanOrEqual(MIN_QUESTION_BANK_SIZE);
  });

  it('refuses to load a bank with too few Default questions, however many add-on ones it has', () => {
    const many = (category: 'default' | 'spicy', count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `${category}${String(i)}`,
        text: `Who is most likely to ${category} ${String(i)}?`,
        category,
      }));
    expect(
      v.safeParse(QuestionBankSchema, [
        ...many('default', MIN_QUESTION_BANK_SIZE - 1),
        ...many('spicy', 100),
      ]).success,
    ).toBe(false);
    expect(v.safeParse(QuestionBankSchema, many('default', MIN_QUESTION_BANK_SIZE)).success).toBe(
      true,
    );
  });

  it('has unique ids and unique texts (ignoring case and punctuation)', () => {
    expect(findBankProblems(QUESTION_BANK)).toEqual([]);
  });

  it(`every text fits on a phone (≤ ${QUESTION_MAX_LENGTH} characters) and is not empty`, () => {
    for (const question of QUESTION_BANK) {
      expect(question.text.trim().length).toBeGreaterThan(0);
      expect(question.text.length).toBeLessThanOrEqual(QUESTION_MAX_LENGTH);
    }
  });

  it('looks questions up by id', () => {
    const first = QUESTION_BANK[0];
    expect(first && getQuestion(first.id)).toEqual(first);
    expect(getQuestion('nope')).toBeUndefined();
  });
});

describe('duplicate detection', () => {
  it('treats case, punctuation and spacing differences as duplicates', () => {
    expect(normalizeQuestionText('Who is most likely to sing?')).toBe(
      normalizeQuestionText('who IS most   likely to sing'),
    );
    expect(
      findBankProblems([
        { id: 'a', text: 'Who is most likely to sing?', category: 'default', labels: 'likely' },
        { id: 'b', text: 'who is most likely to SING!', category: 'default', labels: 'likely' },
        { id: 'a', text: 'Who would you hug the most?', category: 'default', labels: 'most' },
      ]),
    ).toEqual([
      { kind: 'duplicateText', ids: ['a', 'b'] },
      { kind: 'duplicateId', id: 'a' },
    ]);
  });
});

describe('categories and label sets (Q-7…Q-9, G-22, G-23)', () => {
  const q = (
    id: string,
    text: string,
    labels: 'likely' | 'most',
    category = 'default' as const,
  ) => ({
    id,
    text,
    category,
    labels,
  });

  it('every question has a known category and label set (missing labels → "likely")', () => {
    for (const question of QUESTION_BANK) {
      expect(CATEGORY_IDS).toContain(question.category);
      expect(LABEL_SET_IDS).toContain(question.labels);
    }
    expect(
      v.parse(BankQuestionSchema, { id: 'x', text: 'Who is most likely to?', category: 'default' }),
    ).toMatchObject({ labels: 'likely' });
    expect(
      v.safeParse(BankQuestionSchema, { id: 'x', text: 'Who?', category: 'wild' }).success,
    ).toBe(false);
    expect(
      v.safeParse(BankQuestionSchema, {
        id: 'x',
        text: 'Who?',
        category: 'default',
        labels: 'best',
      }).success,
    ).toBe(false);
  });

  it('Q-9 catches a text that disagrees with its label set', () => {
    expect(
      findBankProblems([
        q('ok1', 'Who is most likely to sing?', 'likely'),
        q('ok2', 'Who would you want to kiss the most?', 'most'),
        q('bad1', 'Who would you want to dance with the most?', 'likely'), // forgot "labels": "most"
        q('bad2', 'Who is most likely to cry?', 'most'), // copied the wrong labels
      ]).map((p) => [p.kind, 'id' in p ? p.id : '']),
    ).toEqual([
      ['labelMismatch', 'bad1'],
      ['labelMismatch', 'bad2'],
    ]);
  });

  it('the pool is always Default plus the chosen add-ons — add-ons only make it bigger (G-22)', () => {
    const counts = questionCounts();
    expect(counts.default + counts.spicy + counts.luuppi).toBe(QUESTION_BANK.length);
    expect(questionPool([]).every((question) => question.category === 'default')).toBe(true);
    expect(questionPool([])).toHaveLength(counts.default);
    expect(questionPool(['spicy'])).toHaveLength(counts.default + counts.spicy);
    expect(questionPool(['luuppi'])).toHaveLength(counts.default + counts.luuppi);
    expect(questionPool(['spicy', 'luuppi'])).toHaveLength(QUESTION_BANK.length);
  });

  it('the dev placeholders cover every category and both label sets', () => {
    for (const id of CATEGORY_IDS) expect(questionCounts()[id]).toBeGreaterThan(0);
    for (const id of LABEL_SET_IDS)
      expect(QUESTION_BANK.some((question) => question.labels === id)).toBe(true);
  });
});
