// Nickname rules (G-1, G-14). The same functions run on the phone (instant feedback) and on the
// server (authority), so both always agree.
import { NICKNAME_MAX_GRAPHEMES, NICKNAME_MIN_GRAPHEMES } from './constants';

/** Tabs, newlines and other control whitespace — become a plain space, not deleted ("Mikko\tV"). */
const CONTROL_WHITESPACE = /[\t\n\v\f\r\u0085]/gu;

/**
 * Either (group 1) a subdivision flag tag sequence — black flag U+1F3F4 + tag letters/digits +
 * CANCEL TAG U+E007F, e.g. the flags of Scotland or Wales — which is KEPT, or an invisible character to strip: control (Cc) and formatting (Cf) —
 * bidi overrides, zero-width spaces, stray tag characters (invisible "ASCII smuggling"), … —
 * EXCEPT U+200C ZERO WIDTH NON-JOINER (needed in e.g. Persian names) and U+200D ZERO WIDTH JOINER
 * (multi-part emoji like the family emoji). Written as escapes: a literal invisible character in source is
 * unreadable. Variation selectors (U+FE0F) are category Mn, not Cf, so emoji presentation is kept.
 */
const FLAG_TAGS_OR_INVISIBLE =
  /(\u{1F3F4}[\u{E0030}-\u{E0039}\u{E0061}-\u{E007A}]{1,7}\u{E007F})|(?![\u200C\u200D])[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/gu;
/** Joiners are invisible: ignored when comparing names, so they can't dodge "Name taken". */
const ZERO_WIDTH_NON_JOINER = /\u200C/gu;

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
  return raw
    .replace(CONTROL_WHITESPACE, ' ')
    .replace(FLAG_TAGS_OR_INVISIBLE, (_match, flag: string | undefined) => flag ?? '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
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
  return cleanNickname(nickname.normalize('NFKC')).replace(ZERO_WIDTH_NON_JOINER, '').toLowerCase();
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
