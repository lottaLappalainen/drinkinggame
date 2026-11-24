// Questions about a player (GAME_DESCRIPTION Q-10, G-51): "Who is the closest to [player]?". The
// question text keeps the token; the server picks the player (round.subjectId) and the phone puts
// their name in its place. One definition used by the bank test, the server and the phone.

export const SUBJECT_TOKEN = '[player]';

/** Every `[…]` token in a text — the bank allows only SUBJECT_TOKEN, at most once (Q-10). */
export function bracketTokens(text: string): string[] {
  return text.match(/\[[^\]]*\]/g) ?? [];
}

export function hasSubject(text: string): boolean {
  return text.includes(SUBJECT_TOKEN);
}

/** The text around the token, or null for a regular question. */
export function questionParts(text: string): { before: string; after: string } | null {
  const at = text.indexOf(SUBJECT_TOKEN);
  if (at < 0) return null;
  return { before: text.slice(0, at), after: text.slice(at + SUBJECT_TOKEN.length) };
}
