// 5A: design-system rules that ESLint / Stylelint can't express (CLAUDE.md §7 "UI architecture"),
// plus the pieces that tie index.html, the CSP and the tokens together.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1');
const CLIENT = join(ROOT, 'src/client');

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.test(name) ? [path] : [];
  });
}
const read = (path: string) => readFileSync(path, 'utf8');
const rel = (path: string) => relative(ROOT, path).replaceAll('\\', '/');

describe('CSS Modules (typed-classes decision, 2026-11-24)', () => {
  // Vite types `styles` as {[key: string]: string}: a typo would render silently without its class.
  // Instead of a code generator (a new dependency), this test checks every `styles.x` exists.
  it('every styles.<class> a component reads is defined in its .module.css', () => {
    const missing: string[] = [];
    for (const file of files(CLIENT, /\.tsx?$/)) {
      const source = read(file);
      const imported = /import styles from '(\.\/[\w.]+\.module\.css)';/.exec(source)?.[1];
      if (imported === undefined) continue;
      const css = read(join(file, '..', imported));
      for (const [, name] of source.matchAll(/styles\.(\w+)/g))
        if (name !== undefined && !new RegExp(`\\.${name}(?![\\w-])`).test(css))
          missing.push(`${rel(file)}: styles.${name}`);
    }
    expect(missing).toEqual([]);
  });
});

describe('screen rules decided by the user', () => {
  it('the theme picker (System / Light / Dark) is only on the Home screen (host / join, 2026-11-25)', () => {
    const users = files(join(CLIENT, 'screens'), /\.tsx$/)
      .filter((file) => /<ThemePicker\b/.test(read(file)))
      .map(rel);
    expect(users).toEqual(['src/client/screens/HomeScreen.tsx']);
  });
});

describe('layers: tokens → components → screens', () => {
  it('screens have no CSS files and import no CSS', () => {
    const screens = join(CLIENT, 'screens');
    expect(files(screens, /\.css$/).map(rel)).toEqual([]);
    for (const file of files(screens, /\.tsx?$/))
      expect(read(file), rel(file)).not.toMatch(/\.css['"]/);
  });

  it('"one place": headings get their color only from --color-heading', () => {
    const text = read(join(CLIENT, 'ui/Text.module.css'));
    expect(/\.heading \{[^}]*color: var\(--color-heading\);/.exec(text)).not.toBeNull();
    // No other stylesheet styles heading elements itself — except base.css, the one home of
    // global element styles (margins), which must not color them.
    const base = read(join(CLIENT, 'styles/base.css'));
    expect(base).not.toMatch(/h3\s*\{[^}]*color/);
    for (const file of files(CLIENT, /\.css$/)) {
      if (file.endsWith('tokens.css') || file.endsWith('base.css')) continue;
      expect(read(file), rel(file)).not.toMatch(/(^|[\s,}])h[1-6]\s*[{,:]/m);
    }
  });

  it('components never use raw brand colors as TEXT colors (they use the semantic tokens)', () => {
    for (const file of files(join(CLIENT, 'ui'), /\.css$/))
      expect(read(file), rel(file)).not.toMatch(
        /(^|[^-])color: var\(--color-(primary|secondary|accent)\)/m,
      );
  });

  it('place words come from placeLabel — no component spells out "Most likely"', () => {
    for (const file of files(CLIENT, /\.tsx?$/)) {
      if (file.includes('Gallery')) continue; // the dev gallery's sample texts
      expect(read(file), rel(file)).not.toMatch(/(Most|Least) likely/);
    }
  });
});

describe('index.html, CSP and tokens agree', () => {
  const html = read(join(ROOT, 'index.html'));
  const headers = read(join(ROOT, 'public/_headers'));
  const tokens = read(join(CLIENT, 'styles/tokens.css'));

  it('the CSP allows exactly the pre-paint theme script (by its sha256)', () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
    expect(scripts).toHaveLength(1);
    const hash = createHash('sha256')
      .update(scripts[0] ?? '', 'utf8')
      .digest('base64');
    expect(headers, `put 'sha256-${hash}' into public/_headers`).toContain(`'sha256-${hash}'`);
  });

  it("the script's theme colors are the tokens' page backgrounds (light and dark)", () => {
    const light = /:root \{[\s\S]*?--color-background: (#[0-9a-f]+);/i.exec(tokens)?.[1];
    const dark = /\[data-theme='dark'\] \{[\s\S]*?--color-background: (#[0-9a-f]+);/i.exec(
      tokens,
    )?.[1];
    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(html).toContain(`content="${String(light)}"`); // the meta's first-paint value
    expect(html).toContain(`'${String(dark)}' : '${String(light)}'`);
  });

  it('security headers are on every path', () => {
    for (const header of [
      'X-Content-Type-Options: nosniff',
      'Referrer-Policy:',
      "frame-ancestors 'none'",
    ])
      expect(headers).toContain(header);
  });
});
