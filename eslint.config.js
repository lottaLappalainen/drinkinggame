// ESLint flat config. Encodes the architecture rules from CLAUDE.md so they are enforced,
// not just documented.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Shared by every client rule block (a later block replaces the rule, so it must repeat these).
const CLIENT_RESTRICTED_PATHS = [
  {
    name: 'valibot',
    allowTypeImports: true,
    message: 'The client may only `import type` from valibot (keeps schemas out of the bundle).',
  },
];
const CLIENT_RESTRICTED_PATTERNS = [
  {
    group: ['**/questions/**'],
    message: 'The client must never bundle the question bank (G-33).',
  },
  {
    group: ['**/shared/protocol'],
    allowTypeImports: true,
    message:
      'The client may only `import type` from shared/protocol (its schemas would pull Valibot into the bundle).',
  },
  {
    group: ['**/game/**', '**/server/**'],
    message: 'The client never imports game logic or server code — it talks to the server.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.wrangler/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `_name` marks an intentionally unused parameter/variable (e.g. Phase 2 handler stubs).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // Node-run files: configs and scripts.
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
  },

  // game/ + shared/: pure, deterministic, runtime-free (CLAUDE.md §3, §7 TypeScript).
  {
    files: ['src/game/**/*.ts', 'src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/**', '**/client/**'],
              message: 'game/ and shared/ must not import server/ or client/.',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use ctx.now (deterministic, testable).' },
        { object: 'Math', property: 'random', message: 'Use the injected random source from ctx.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Use ctx.now instead of new Date().',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'crypto',
          message:
            'No crypto in game/ or shared/ — randomness comes from ctx, hashing happens in the server.',
        },
      ],
    },
  },

  // Client: browser globals; never bundle the question bank (G-33), game logic or server code;
  // Valibot and the protocol schemas only as types.
  {
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: CLIENT_RESTRICTED_PATHS, patterns: CLIENT_RESTRICTED_PATTERNS },
      ],
      // Design system: no inline styles. The only allowed exception is a runtime-computed
      // transform/opacity/custom property — disable this rule on that line with a reason.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='style']",
          message:
            'No inline styles (CLAUDE.md §7 UI architecture). Use a ui/ component + tokens. Only runtime transforms are allowed, with an eslint-disable comment explaining why.',
        },
      ],
    },
  },

  // Screens compose ui/ components and contain no styling of their own.
  {
    files: ['src/client/screens/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: CLIENT_RESTRICTED_PATHS,
          patterns: [
            ...CLIENT_RESTRICTED_PATTERNS,
            {
              group: ['*.css'],
              message:
                'Screens have no CSS (CLAUDE.md §7). Missing look → add a component or variant in client/ui/.',
            },
          ],
        },
      ],
    },
  },

  // Unit tests and e2e run in Node.
  {
    files: ['test/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
