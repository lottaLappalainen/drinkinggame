// Stylelint enforces the design system (CLAUDE.md §7 "UI architecture"):
// raw values (colors, sizes, durations) are allowed ONLY in src/client/styles/tokens.css.
// Everything else must use tokens (CSS custom properties).
/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
      'color',
    ],
    'unit-disallowed-list': [
      'px',
      'rem',
      'em',
      'ms',
      's',
      'vh',
      'vw',
      'dvh',
      'svh',
      'lvh',
      'pt',
      'ch',
      'ex',
    ],
  },
  overrides: [
    {
      files: ['src/client/styles/tokens.css'],
      rules: {
        'color-no-hex': null,
        'color-named': null,
        'function-disallowed-list': null,
        'unit-disallowed-list': null,
      },
    },
  ],
};
