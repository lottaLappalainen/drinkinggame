// G-22, G-23, G-31: the question draw at Start.
import { describe, expect, it } from 'vitest';
import { drawQuestions } from '../../../src/game/rounds/draw';
import { shuffle } from '../../../src/game/rounds/shuffle';
import { QUESTION_BANK, questionCounts } from '../../../src/game/questions';
import { GAME_LENGTHS } from '../../../src/shared/constants';
import type { Question } from '../../../src/shared/protocol';
import { CATEGORY_IDS, type CategoryId } from '../../../src/shared/questionCategories';
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

describe('drawQuestions (G-31)', () => {
  const counts = questionCounts();
  const subsets = (): CategoryId[][] => {
    const all: CategoryId[][] = [];
    for (let mask = 1; mask < 1 << CATEGORY_IDS.length; mask++)
      all.push(CATEGORY_IDS.filter((_, i) => mask & (1 << i)));
    return all;
  };

  it('10,000 random games never repeat a question and never leave the chosen categories', () => {
    const random = seeded(2026);
    const options = subsets();
    let drawn = 0;
    let refused = 0;
    for (let game = 0; game < 10_000; game++) {
      const categories = options[Math.floor(random() * options.length)] ?? options[0] ?? [];
      const length = GAME_LENGTHS[Math.floor(random() * GAME_LENGTHS.length)] ?? 15;
      const questions = drawQuestions(categories, length, random);
      const poolSize = categories.reduce((sum, id) => sum + counts[id], 0);
      if (questions === null) {
        refused++;
        expect(poolSize).toBeLessThan(length); // refused exactly when the pool is too small (G-23)
        continue;
      }
      drawn++;
      expect(questions).toHaveLength(length);
      expect(new Set(questions.map((q) => q.id)).size).toBe(length);
      for (const q of questions) expect(categories).toContain(q.category);
    }
    // The placeholder bank (20 / 10 / 10) must exercise both outcomes.
    expect(drawn).toBeGreaterThan(1000);
    expect(refused).toBeGreaterThan(1000);
  });

  it('draws every question of the pool with the same probability', () => {
    const random = seeded(5);
    const seen = new Map<string, number>();
    const games = 4000;
    for (let i = 0; i < games; i++)
      for (const q of drawQuestions(['mild', 'spicy'], 15, random) ?? [])
        seen.set(q.id, (seen.get(q.id) ?? 0) + 1);
    expect(seen.size).toBe(counts.mild + counts.spicy);
    // Each of the 30 questions is in 15 of 30 draws: ~50%.
    for (const count of seen.values()) {
      expect(count / games).toBeGreaterThan(0.44);
      expect(count / games).toBeLessThan(0.56);
    }
  });

  it('copies the questions, text, category and label set — the game never reads the bank again', () => {
    const [first] = drawQuestions(['mild', 'spicy', 'personal'], 35, seeded(1)) ?? [];
    expect(first).toBeDefined();
    if (!first) return;
    first.text = 'changed';
    expect(QUESTION_BANK.some((q) => q.text === 'changed')).toBe(false);
    expect(Object.keys(first).sort()).toEqual(['category', 'id', 'labels', 'text']);
  });

  it('works on any bank it is given, and refuses a pool that is one question short', () => {
    const bank: Question[] = Array.from({ length: 5 }, (_, i) => ({
      id: `x${i}`,
      text: `Who is most likely to ${i}?`,
      category: 'mild',
      labels: 'likely',
    }));
    expect(drawQuestions(['mild'], 5, seeded(1), bank)).toHaveLength(5);
    expect(drawQuestions(['mild'], 6, seeded(1), bank)).toBeNull();
    expect(drawQuestions(['spicy'], 1, seeded(1), bank)).toBeNull();
  });
});
