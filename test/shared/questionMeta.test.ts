// Categories (Q-7) and label sets (Q-8, Q-9): the shared modules phones and server both use.
import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  CATEGORY_IDS,
  DEFAULT_CATEGORIES,
  categoryById,
  normalizeCategories,
} from '../../src/shared/questionCategories';
import {
  LABEL_SETS,
  LABEL_SET_IDS,
  labelMismatch,
  ordinal,
  placeLabel,
} from '../../src/shared/questionLabels';

describe('categories (Q-7, G-22)', () => {
  it('CATEGORIES lists every id exactly once, in display order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([...CATEGORY_IDS]);
    for (const id of CATEGORY_IDS) expect(categoryById(id).id).toBe(id);
  });

  it('defaults to Mild + Spicy (Personal is opt-in)', () => {
    expect(DEFAULT_CATEGORIES).toEqual(['mild', 'spicy']);
  });

  it('normalizes a selection to display order without duplicates', () => {
    expect(normalizeCategories(['personal', 'mild', 'personal'])).toEqual(['mild', 'personal']);
  });
});

describe('label sets (Q-8)', () => {
  it('every set has all four labels', () => {
    for (const id of LABEL_SET_IDS) {
      const set = LABEL_SETS[id];
      for (const label of [set.top, set.second, set.third, set.bottom])
        expect(label.trim()).not.toBe('');
    }
  });

  it("places map to the question's words: top, 2nd, 3rd, bottom, then ordinals", () => {
    // 8 players shown, last place 8.
    expect([1, 2, 3, 4, 7, 8].map((p) => placeLabel('likely', p, 8))).toEqual([
      'Most likely',
      '2nd most likely',
      '3rd most likely',
      '4th',
      '7th',
      'Least likely',
    ]);
    expect([1, 2, 3, 8].map((p) => placeLabel('most', p, 8))).toEqual([
      'Most',
      '2nd most',
      '3rd most',
      'Least',
    ]);
  });

  it('the last place is the bottom label even when it is 2nd or 3rd (small games, ties — G-50)', () => {
    expect(placeLabel('likely', 3, 3)).toBe('Least likely'); // 3 players
    expect(placeLabel('most', 2, 2)).toBe('Least'); // two places in total: 1 and 2
    expect(placeLabel('likely', 1, 1)).toBe('Most likely'); // everyone tied: top wins
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 25].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '25th',
    ]);
  });
});

describe('text ↔ label check (Q-9)', () => {
  it('accepts matching wording', () => {
    expect(labelMismatch('Who is most likely to fall asleep?', 'likely')).toBeNull();
    expect(labelMismatch('Who is LEAST likely to cry?', 'likely')).toBeNull();
    expect(labelMismatch('Who would you want to kiss the most?', 'most')).toBeNull();
  });

  it('flags a forgotten or wrong labels field', () => {
    expect(labelMismatch('Who would you want to kiss the most?', 'likely')).not.toBeNull();
    expect(labelMismatch('Who is most likely to cry?', 'most')).not.toBeNull();
  });
});
