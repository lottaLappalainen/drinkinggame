import { describe, expect, it, vi } from 'vitest';
import { NICKNAME_MAX_GRAPHEMES } from '../../src/shared/constants';
import {
  cleanNickname,
  graphemeLength,
  nameKey,
  validateNickname,
} from '../../src/shared/nickname';

describe('cleanNickname (G-1)', () => {
  it('strips bidi overrides and zero-width characters', () => {
    expect(cleanNickname('Mi‮kko')).toBe('Mikko'); // right-to-left override
    expect(cleanNickname('Mik​ko')).toBe('Mikko'); // zero-width space
    expect(cleanNickname('﻿Mikko')).toBe('Mikko'); // byte order mark
  });

  it('strips control characters', () => {
    expect(cleanNickname('Mik\u0000ko\u0007')).toBe('Mikko');
  });

  it('keeps multi-part emoji intact (ZWJ and variation selectors stay)', () => {
    const family = '👨‍👩‍👧';
    const heart = '❤️';
    expect(cleanNickname(`Aino ${family}`)).toBe(`Aino ${family}`);
    expect(cleanNickname(`${heart} Ville`)).toBe(`${heart} Ville`);
  });

  it('trims and collapses whitespace', () => {
    expect(cleanNickname('  Mikko   the \t great  ')).toBe('Mikko the great');
  });
});

describe('graphemeLength (G-1)', () => {
  it('counts emoji as one character each', () => {
    expect(graphemeLength('Aino')).toBe(4);
    expect(graphemeLength('👨‍👩‍👧')).toBe(1);
    expect(graphemeLength('🍕🍕')).toBe(2);
    expect(graphemeLength('🇫🇮')).toBe(1); // flag = two regional indicators
  });
});

describe('validateNickname (G-1)', () => {
  it('accepts and returns the cleaned value', () => {
    expect(validateNickname('  Juho 🍕 ')).toEqual({ ok: true, nickname: 'Juho 🍕' });
  });

  it('rejects empty and invisible-only names', () => {
    expect(validateNickname('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(validateNickname('​‮')).toEqual({ ok: false, reason: 'empty' });
  });

  it(`allows exactly ${NICKNAME_MAX_GRAPHEMES} graphemes, not more`, () => {
    const max = '🍕'.repeat(NICKNAME_MAX_GRAPHEMES);
    expect(validateNickname(max).ok).toBe(true);
    expect(validateNickname(`${max}a`)).toEqual({ ok: false, reason: 'tooLong' });
  });
});

describe('nameKey (G-14)', () => {
  it('ignores case and extra spaces', () => {
    expect(nameKey('Mikko')).toBe(nameKey(' mikko  '));
    expect(nameKey('Mikko  Virtanen')).toBe(nameKey('mikko virtanen'));
  });

  it('folds compatibility forms (full-width letters)', () => {
    expect(nameKey('Ｍｉｋｋｏ')).toBe(nameKey('Mikko'));
  });

  it('ignores invisible characters, so they cannot dodge "Name taken"', () => {
    expect(nameKey('Mik​ko')).toBe(nameKey('Mikko'));
  });

  it('keeps different names different', () => {
    expect(nameKey('Mikko')).not.toBe(nameKey('Miikka'));
  });
});

describe('without Intl.Segmenter (Firefox < 125, inside the browser target)', () => {
  it('still works, counting code points — never more lenient than the server', async () => {
    const original = Intl.Segmenter;
    vi.resetModules();
    Reflect.deleteProperty(Intl, 'Segmenter'); // simulate an old browser
    try {
      const fallback = await import('../../src/shared/nickname');
      expect(fallback.graphemeLength('Aino')).toBe(4);
      // A ZWJ family emoji counts as 5 code points instead of 1 grapheme: stricter, not looser.
      expect(fallback.graphemeLength('👨‍👩‍👧')).toBe(5);
      expect(fallback.validateNickname('Juho 🍕')).toEqual({ ok: true, nickname: 'Juho 🍕' });
    } finally {
      Reflect.set(Intl, 'Segmenter', original);
      vi.resetModules();
    }
  });
});

describe('nickname cleaning — review fixes (Phase 2)', () => {
  const ch = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
  const ZWNJ = ch(0x200c);
  // Flag of Scotland: black flag + tag letters "gbsct" + CANCEL TAG.
  const SCOTLAND = ch(0x1f3f4, 0xe0067, 0xe0062, 0xe0073, 0xe0063, 0xe0074, 0xe007f);

  it('turns tabs and newlines into spaces instead of gluing words together', () => {
    expect(cleanNickname('Mikko\tVirtanen')).toBe('Mikko Virtanen');
    expect(cleanNickname('Mikko\nVirtanen')).toBe('Mikko Virtanen');
  });

  it('keeps ZERO WIDTH NON-JOINER (needed in e.g. Persian names)', () => {
    const name = `${ch(0x0645, 0x06cc)}${ZWNJ}${ch(0x062e, 0x0648, 0x0627, 0x0647, 0x0645)}`; // a Persian word that needs a ZWNJ
    expect(cleanNickname(name)).toBe(name);
  });

  it('…but ignores it for "Name taken", so it cannot be used to dodge the check (G-14)', () => {
    expect(nameKey(`Mik${ZWNJ}ko`)).toBe(nameKey('Mikko'));
  });

  it('keeps subdivision flags (tag sequences) intact', () => {
    expect(cleanNickname(`Juho ${SCOTLAND}`)).toBe(`Juho ${SCOTLAND}`);
    expect(graphemeLength(SCOTLAND)).toBe(1);
  });

  it('strips stray tag characters (invisible text smuggled into a name)', () => {
    const smuggled = `Aino${ch(0xe0068, 0xe0069)}`; // invisible "hi"
    expect(cleanNickname(smuggled)).toBe('Aino');
  });

  it('the source files contain no literal invisible characters (they are written as escapes)', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/shared/nickname.ts', 'utf8');
    const invisible = [...source].filter((c) => /[\p{Cf}]/u.test(c));
    expect(invisible.map((c) => c.codePointAt(0)?.toString(16))).toEqual([]);
  });
});
