import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Three test projects. Every *.test.ts(x) under test/ belongs to exactly one of them, so no test
// file can be silently skipped:
// - unit:    everything except test/server and test/client — game/ + shared/ logic, fixtures (Node)
// - client:  test/client — Preact app code (store, connection manager, …); JSX via Preact (Node)
// - workers: test/server — Worker + Durable Object inside the real Workers runtime (workerd)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts'],
          exclude: ['test/server/**', 'test/client/**'],
          environment: 'node',
        },
      },
      {
        oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
        test: {
          name: 'client',
          include: ['test/client/**/*.test.{ts,tsx}'],
          environment: 'node',
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'workers',
          include: ['test/server/**/*.test.ts'],
        },
      },
    ],
  },
});
