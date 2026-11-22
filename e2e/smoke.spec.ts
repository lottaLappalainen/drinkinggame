// Phase 1 smoke test: the page loads on emulated phones, a join-link path serves the same app
// (SPA fallback), and the WebSocket echo through the Durable Object works.
import { expect, test } from '@playwright/test';

test('home page loads and the WebSocket echo works', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'drinkinggame' })).toBeVisible();
  await expect(page.getByTestId('ws-status')).toHaveText('open');
  await expect(page.getByTestId('echo')).toHaveText('echo:hello');
});

test('a join link (/g/KEY) serves the same app', async ({ page }) => {
  await page.goto('/g/ABCDE');
  await expect(page.getByRole('heading', { name: 'drinkinggame' })).toBeVisible();
  await expect(page.getByTestId('path')).toHaveText('/g/ABCDE');
  await expect(page.getByTestId('echo')).toHaveText('echo:hello');
});
