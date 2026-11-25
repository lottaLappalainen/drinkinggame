// G-22, G-23, G-31: the question draw at Start.
import { describe, expect, it } from 'vitest';
import { drawQuestions } from '../../../src/game/rounds/draw';
import { shuffle } from '../../../src/game/rounds/shuffle';
import { QUESTION_BANK, questionCounts } from '../../../src/game/questions';
import { GAME_LENGTHS } from '../../../src/shared/constants';
import type { Question } from '../../../src/shared/protocol';
import {
  ADD_ON_CATEGORY_IDS,
  gameCategories,
  type AddOnCategoryId,
  type CategoryId,
} from '../../../src/shared/questionCategories';
import { seeded } from '../players/session';

describe('shuffle', () => {
  it('is a permutation, deterministic for a seed, and survives a random() of exactly 1', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffle([...items], seeded(7));
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(shuffle([...items], seeded(7))).toEqual(a);
    expect(shuffle([...items], () => 1)).toHaveLength(20);
  });

  it('puts every item in every position about equally often', () => {
    const random = seeded(99);
    const counts = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
    const runs = 8000;
    for (let i = 0; i < runs; i++) {
      shuffle([0, 1, 2, 3], random).forEach((item, position) => {
        const row = counts[item];
        if (row) row[position] = (row[position] ?? 0) + 1;
      });
    }
    for (const row of counts) for (const count of row) expect(count / runs).toBeGreaterThan(0.2); // fair would be 0.25
  });
});

describe('drawQuestions (G-22, G-31)', () => {
  const counts = questionCounts();
  /** Every add-on selection, including none. */
  const subsets = (): AddOnCategoryId[][] => {
    const all: AddOnCategoryId[][] = [];
    for (let mask = 0; mask < 1 << ADD_ON_CATEGORY_IDS.length; mask++)
      all.push(ADD_ON_CATEGORY_IDS.filter((_, i) => mask & (1 << i)));
    return all;
  };

  it('3,000 random games never repeat a question and never leave the chosen categories', () => {
    const random = seeded(2026);
    const options = subsets();
    for (let game = 0; game < 3_000; game++) {
      const addOns = options[Math.floor(random() * options.length)] ?? [];
      const length = GAME_LENGTHS[Math.floor(random() * GAME_LENGTHS.length)] ?? 15;
      const questions = drawQuestions(addOns, length, random);
      // The bank keeps ≥ 35 Default questions, so every length fits every selection (G-23).
      expect(questions).not.toBeNull();
      if (questions === null) continue;
      expect(questions).toHaveLength(length);
      expect(new Set(questions.map((q) => q.id)).size).toBe(length);
      const allowed: readonly CategoryId[] = gameCategories(addOns);
      for (const q of questions) expect(allowed).toContain(q.category);
    }
  });

  it('draws every question of the pool with the same probability — no quotas per category', () => {
    const random = seeded(5);
    const seen = new Map<string, number>();
    const games = 4000;
    const pool = counts.default + counts.spicy;
    for (let i = 0; i < games; i++)
      for (const q of drawQuestions(['spicy'], 15, random) ?? [])
        seen.set(q.id, (seen.get(q.id) ?? 0) + 1);
    expect(seen.size).toBe(pool);
    // Each question is in 15 of `pool` draws.
    const expected = 15 / pool;
    for (const count of seen.values()) {
      expect(count / games).toBeGreaterThan(expected - 0.06);
      expect(count / games).toBeLessThan(expected + 0.06);
    }
  });

  it('copies the questions, text, category and label set — the game never reads the bank again', () => {
    const [first] = drawQuestions(['spicy', 'luuppi'], 35, seeded(1)) ?? [];
    expect(first).toBeDefined();
    if (!first) return;
    first.text = 'changed';
    expect(QUESTION_BANK.some((q) => q.text === 'changed')).toBe(false);
    expect(Object.keys(first).sort()).toEqual(['category', 'id', 'labels', 'text']);
  });

  it('works on any bank it is given, and refuses a pool that is one question short (safety net)', () => {
    const bank: Question[] = Array.from({ length: 5 }, (_, i) => ({
      id: `x${String(i)}`,
      text: `Who is most likely to ${String(i)}?`,
      category: i < 3 ? 'default' : 'spicy',
      labels: 'likely',
    }));
    expect(drawQuestions([], 3, seeded(1), { bank })).toHaveLength(3);
    expect(drawQuestions([], 4, seeded(1), { bank })).toBeNull(); // Default alone: 3
    expect(drawQuestions(['spicy'], 5, seeded(1), { bank })).toHaveLength(5);
    expect(drawQuestions(['luuppi'], 4, seeded(1), { bank })).toBeNull();
  });
});

describe('play again (G-52): questions the group has not had come first', () => {
  const bank: Question[] = Array.from({ length: 10 }, (_, i) => ({
    id: `y${String(i)}`,
    text: `Who is most likely to ${String(i)}?`,
    category: 'default',
    labels: 'likely',
  }));
  const ids = (questions: Question[] | null) => (questions ?? []).map((q) => q.id);

  it('draws only unplayed questions while there are enough of them', () => {
    const played = ['y0', 'y1', 'y2', 'y3', 'y4', 'y5'];
    for (let seed = 1; seed <= 50; seed++)
      expect(ids(drawQuestions([], 4, seeded(seed), { bank, played })).sort()).toEqual([
        'y6',
        'y7',
        'y8',
        'y9',
      ]);
  });

  it('tops up with played ones when the unplayed run out: every unplayed one in, no repeats', () => {
    const played = ['y0', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6'];
    for (let seed = 1; seed <= 50; seed++) {
      const drawn = ids(drawQuestions([], 6, seeded(seed), { bank, played }));
      expect(new Set(drawn).size).toBe(6);
      for (const id of ['y7', 'y8', 'y9']) expect(drawn).toContain(id);
    }
  });

  it('the top-up is mixed in, not always at the end of the game', () => {
    const played = ['y0', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6'];
    const lastIsFresh = Array.from({ length: 40 }, (_, seed) =>
      ['y7', 'y8', 'y9'].includes(
        ids(drawQuestions([], 6, seeded(seed + 1), { bank, played }))[5] ?? '',
      ),
    );
    expect(lastIsFresh).toContain(true);
    expect(lastIsFresh).toContain(false);
  });

  it('with no history the draw is exactly what it was before play again existed', () => {
    for (let seed = 1; seed <= 20; seed++)
      expect(drawQuestions([], 5, seeded(seed), { bank, played: [] })).toEqual(
        drawQuestions([], 5, seeded(seed), { bank }),
      );
  });
});
