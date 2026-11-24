// Joins class names, skipping the falsy ones (`cx(styles.a, on && styles.b)`).
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ');
}

/** The spacing scale (tokens.css --space-0 … --space-8) — layout props take one of these. */
export type Space = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
