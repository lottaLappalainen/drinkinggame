// Q-4: the bank must always be valid — this test guards the user's question file too.
import { describe, expect, it } from 'vitest';
import {
  QUESTION_BANK,
  findBankProblems,
  getQuestion,
  normalizeQuestionText,
} from '../../src/game/questions';
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
        { id: 'a', text: 'Who is most likely to sing?' },
        { id: 'b', text: 'who is most likely to SING!' },
        { id: 'a', text: 'Something else?' },
      ]),
    ).toEqual([
      { kind: 'duplicateText', ids: ['a', 'b'] },
      { kind: 'duplicateId', id: 'a' },
    ]);
  });
});
