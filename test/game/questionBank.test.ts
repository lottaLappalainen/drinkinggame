// Q-4: the bank must always be valid — this test guards the user's question file too.
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  BankQuestionSchema,
  QUESTION_BANK,
  findBankProblems,
  getQuestion,
  normalizeQuestionText,
  poolCanFill,
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
  it(`has at least ${MIN_QUESTION_BANK_SIZE} questions (the longest game)`, () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(Math.max(...GAME_LENGTHS));
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
        { id: 'a', text: 'Who is most likely to sing?', category: 'mild', labels: 'likely' },
        { id: 'b', text: 'who is most likely to SING!', category: 'mild', labels: 'likely' },
        { id: 'a', text: 'Who would you hug the most?', category: 'mild', labels: 'most' },
      ]),
    ).toEqual([
      { kind: 'duplicateText', ids: ['a', 'b'] },
      { kind: 'duplicateId', id: 'a' },
    ]);
  });
});

describe('categories and label sets (Q-7…Q-9, G-22, G-23)', () => {
  const q = (id: string, text: string, labels: 'likely' | 'most', category = 'mild' as const) => ({
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
      v.parse(BankQuestionSchema, { id: 'x', text: 'Who is most likely to?', category: 'mild' }),
    ).toMatchObject({ labels: 'likely' });
    expect(
      v.safeParse(BankQuestionSchema, { id: 'x', text: 'Who?', category: 'wild' }).success,
    ).toBe(false);
    expect(
      v.safeParse(BankQuestionSchema, { id: 'x', text: 'Who?', category: 'mild', labels: 'best' })
        .success,
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

  it('pools and counts by category; a selection can fill a length only with enough questions', () => {
    const counts = questionCounts();
    expect(counts.mild + counts.spicy + counts.personal).toBe(QUESTION_BANK.length);
    expect(questionPool(['spicy']).every((question) => question.category === 'spicy')).toBe(true);
    expect(questionPool(['mild', 'spicy'])).toHaveLength(counts.mild + counts.spicy);
    const small = { mild: 20, spicy: 10, personal: 10 };
    expect(poolCanFill(['mild', 'spicy'], 25, small)).toBe(true);
    expect(poolCanFill(['mild', 'spicy'], 35, small)).toBe(false);
    expect(poolCanFill(['personal'], 15, small)).toBe(false);
  });

  it('the dev placeholders cover every category and both label sets', () => {
    for (const id of CATEGORY_IDS) expect(questionCounts()[id]).toBeGreaterThan(0);
    for (const id of LABEL_SET_IDS)
      expect(QUESTION_BANK.some((question) => question.labels === id)).toBe(true);
  });
});
