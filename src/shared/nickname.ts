// Nickname rules (G-1, G-14). The same functions run on the phone (instant feedback) and on the
// server (authority), so both always agree.
import { NICKNAME_MAX_GRAPHEMES, NICKNAME_MIN_GRAPHEMES } from './constants';

/**
 * Control (Cc) and invisible formatting (Cf) characters — bidi overrides, zero-width spaces, … —
 * EXCEPT U+200D ZERO WIDTH JOINER, which multi-part emoji (👨‍👩‍👧) need.
 * Variation selectors (U+FE0F) are category Mn, not Cf, so emoji presentation is kept.
 */
const INVISIBLE = /(?!‍)[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/gu;

// Intl.Segmenter is missing in Firefox < 125, which is inside our browser target (CLAUDE.md §2
// "Browsers"). Without it, fall back to counting code points: that over-counts multi-part emoji, so
// the phone's instant feedback can only be stricter than the server's. The server (workerd) always
// has Intl.Segmenter and is the authority (G-1).
const segmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Strips invisible/control characters, trims and collapses inner whitespace. */
export function cleanNickname(raw: string): string {
  return raw.replace(INVISIBLE, '').replace(WHITESPACE_RUN, ' ').trim();
}

/** Length as people see it: an emoji (even a multi-part one) counts as one character. */
export function graphemeLength(text: string): number {
  if (segmenter === null) return Array.from(text).length;
  let count = 0;
  for (const _ of segmenter.segment(text)) count++;
  return count;
}

/** Comparison key for "Name taken" (G-14): ignores case, extra spaces and compatibility forms. */
export function nameKey(nickname: string): string {
  return cleanNickname(nickname.normalize('NFKC')).toLowerCase();
}

export type NicknameResult =
  | { readonly ok: true; readonly nickname: string }
  | { readonly ok: false; readonly reason: 'empty' | 'tooLong' };

/** Cleans and validates a nickname. Use the returned (cleaned) value, never the raw input. */
export function validateNickname(raw: string): NicknameResult {
  const nickname = cleanNickname(raw);
  const length = graphemeLength(nickname);
  if (length < NICKNAME_MIN_GRAPHEMES) return { ok: false, reason: 'empty' };
  if (length > NICKNAME_MAX_GRAPHEMES) return { ok: false, reason: 'tooLong' };
  return { ok: true, nickname };
}
