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
      ['px', 'rem', 'em', 'ms', 's', 'vh', 'vw', 'dvh', 'svh', 'lvh', 'pt', 'ch', 'ex'],
      // Media queries can't use CSS variables: a width breakpoint in px is the one raw size
      // allowed outside tokens.css (Phase 1 review).
      { ignoreMediaFeatureNames: { px: ['width', 'min-width', 'max-width'] } },
    ],
  },
  overrides: [
    // CSS Modules (Phase 1 review): code reads styles.camelCase, so classes are camelCase;
    // :global / :local and composes are CSS Modules syntax, not errors.
    {
      files: ['**/*.module.css'],
      rules: {
        'selector-class-pattern': [
          '^[a-z][a-zA-Z0-9]*$',
          { message: 'CSS Module classes are camelCase (code reads styles.camelCase)' },
        ],
        'selector-pseudo-class-no-unknown': [true, { ignorePseudoClasses: ['global', 'local'] }],
        'property-no-unknown': [true, { ignoreProperties: ['composes'] }],
      },
    },
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
