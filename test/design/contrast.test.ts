// 5A: every color pairing the components use, contrast-checked in BOTH themes straight from
// tokens.css (CLAUDE.md "Styling & animation"): text ≥ 4.5:1, non-text indicators ≥ 3:1
// (WCAG 1.4.3 / 1.4.11). Changing a token so a pairing fails breaks this test.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/client/styles/tokens.css', import.meta.url), 'utf8');

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const map = new Map<string, string>();
  for (const match of body.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    if (match[1] !== undefined && match[2] !== undefined) map.set(match[1], match[2].trim());
  return map;
}

const ROOT = block(':root');
const THEMES = {
  light: ROOT,
  dark: new Map([...ROOT, ...block("[data-theme='dark']")]),
};

function hex(tokens: Map<string, string>, name: string): string {
  let value = tokens.get(name);
  for (let i = 0; i < 10 && value?.startsWith('var(') === true; i++)
    value = tokens.get(value.slice(4, -1).trim());
  const color = value?.replace(/\/\*.*$/, '').trim();
  if (color === undefined || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color))
    throw new Error(`${name} is not a plain hex color: ${String(value)}`);
  return color.replace(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i, '#$1$1$2$2$3$3');
}

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background] — text pairings, each used by a component. */
const TEXT: readonly [string, string][] = [
  ['--color-on-background', '--color-background'],
  ['--color-on-surface', '--color-surface'],
  ['--color-text', '--color-surface-muted'],
  ['--color-text-muted', '--color-background'],
  ['--color-text-muted', '--color-surface'],
  ['--color-heading', '--color-background'],
  ['--color-heading', '--color-surface'],
  ['--color-link', '--color-background'],
  ['--color-link', '--color-surface'],
  ['--color-on-primary', '--color-primary'],
  ['--color-on-secondary', '--color-secondary'],
  ['--color-on-accent', '--color-accent'],
  ['--color-on-danger', '--color-danger'],
  ['--color-danger-text', '--color-surface'], // field errors
  ['--color-danger-text', '--color-background'],
  ['--color-success', '--color-surface-muted'], // "Ready ✓" badge
  ['--color-background', '--color-text'], // toast (inverted)
  ['--color-qr-modules', '--color-qr-background'],
];

/** Non-text indicators next to what surrounds them. */
const INDICATORS: readonly [string, string][] = [
  ['--color-indicator', '--color-background'],
  ['--color-indicator', '--color-surface'],
  ['--color-indicator', '--color-surface-muted'], // countdown bar on its track
  ['--color-indicator-strong', '--color-background'], // "most likely" ring
  ['--color-focus-ring', '--color-background'],
  ['--color-focus-ring', '--color-surface'],
  ['--color-slot-border', '--color-background'],
  ['--color-slot-border', '--color-surface'],
];

describe.each(Object.entries(THEMES))('%s theme', (_name, tokens) => {
  it.each(TEXT)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(hex(tokens, fg), hex(tokens, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(INDICATORS)('indicator %s next to %s ≥ 3:1', (fg, bg) => {
    expect(contrast(hex(tokens, fg), hex(tokens, bg))).toBeGreaterThanOrEqual(3);
  });
});

describe('the contrast math', () => {
  it('matches the values measured in CLAUDE.md', () => {
    expect(contrast('#ffffff', '#981b5d')).toBeCloseTo(7.9, 1);
    expect(contrast('#321b27', '#e2b436')).toBeCloseTo(8.2, 1);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });
});
