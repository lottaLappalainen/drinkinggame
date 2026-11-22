import { cloudflare } from '@cloudflare/vite-plugin';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

// Oldest supported phone browsers (CLAUDE.md §2 "Browsers"). Vite only rewrites newer *syntax*
// for these; it adds no missing built-ins — that's why tsconfig.client/core use the ES2023 lib.
// Same list as Vite's 'baseline-widely-available' default, written out so it can't drift silently.
const BROWSER_TARGET = ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'];

// One `npm run dev` runs the client and the Worker + Durable Object in the real Workers runtime.
// The Cloudflare environment is chosen at build time: `vite build --mode staging` loads
// .env.staging (CLOUDFLARE_ENV=staging); plain `vite build` = production (top-level config).
export default defineConfig({
  plugins: [preact(), cloudflare()],
  environments: {
    client: { build: { target: BROWSER_TARGET } },
  },
});
