// ESLint flat config. Encodes the architecture rules from CLAUDE.md so they are enforced,
// not just documented.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Flat config REPLACES a rule's options per block (no merging), so every list that several blocks
// need is built from these constants — they can't drift apart.

// Shared by every client rule block.
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

/** CLAUDE.md §7: named exports only. Exceptions (Worker entry, tool configs) turn this off. */
const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message: 'Named exports only (CLAUDE.md §7 TypeScript).',
};
/** game/ + shared/ are deterministic: time comes from ctx.now. */
const NO_CLOCK = [
  { selector: "NewExpression[callee.name='Date']", message: 'Use ctx.now instead of new Date().' },
  { selector: "CallExpression[callee.name='Date']", message: 'Use ctx.now instead of Date().' },
];
/** Design system: no inline styles (runtime transforms only, with an eslint-disable + reason). */
const NO_INLINE_STYLE = {
  selector: "JSXAttribute[name.name='style']",
  message:
    'No inline styles (CLAUDE.md §7 UI architecture). Use a ui/ component + tokens. Only runtime transforms are allowed, with an eslint-disable comment explaining why.',
};

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
  // Type-aware rules: floating promises, unnecessary conditions, unsafe `any` flows, `!`, …
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Finds the right tsconfig scope for each file via the solution-style tsconfig.json.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // `_name` marks an intentionally unused parameter/variable (e.g. handler stubs).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Exhaustive switches over unions (CLAUDE.md §7) — not part of the strict preset.
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      // State is records keyed by id (players, connections, reclaims): deleting by key is the
      // intended way to drop an entry.
      '@typescript-eslint/no-dynamic-delete': 'off',
      // Template literals with numbers are fine and common here (ids, messages).
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT],
    },
  },

  // Plain JS files (tool configs, scripts) aren't in any tsconfig: no type-aware rules there.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // Node-run files: configs and scripts. Tools require a default export from their config.
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-restricted-syntax': 'off' },
  },
  // The Workers runtime requires `export default { fetch }` from the Worker entry.
  {
    files: ['src/server/worker.ts'],
    rules: { 'no-restricted-syntax': 'off' },
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
        {
          object: 'globalThis',
          property: 'crypto',
          message: 'No crypto in game/ or shared/ — randomness comes from ctx.',
        },
      ],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT, ...NO_CLOCK],
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
  // Valibot and the protocol schemas only as types; hooks rules (Preact hooks follow React's).
  {
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      // Accessibility rules (the plugin's recommended set) — phones, small tap targets, party use.
      ...jsxA11y.flatConfigs.recommended.rules,
      // Only these two: the v7 "recommended" set adds React-Compiler rules that assume React.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { paths: CLIENT_RESTRICTED_PATHS, patterns: CLIENT_RESTRICTED_PATTERNS },
      ],
      'no-restricted-syntax': ['error', NO_DEFAULT_EXPORT, NO_INLINE_STYLE],
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
    files: ['test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
