import { defineConfig, devices } from '@playwright/test';

const PORT = 5197;

// The CSP check (`npm run test:csp`): a PRODUCTION build served by `vite preview`, which — unlike
// `npm run dev` — applies public/_headers. Proves the app still works with the CSP on: the inline
// theme script (allowed by hash), the lazy QR chunk, the WebSocket, CSS-variable timers.
export default defineConfig({
  testDir: './e2e-csp',
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}`, ...devices['iPhone 15'] },
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
