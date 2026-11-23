// Smoke test: the page loads on emulated phones, a join-link path serves the same app (SPA
// fallback), and the whole server path works — create a game, open its socket, receive the lobby.
import { expect, test } from '@playwright/test';

test('home page loads and a game can be created and joined', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'drinkinggame' })).toBeVisible();
  await expect(page.getByTestId('ws-status')).toHaveText('open');
  await expect(page.getByTestId('server')).toHaveText(/^lobby [A-Z0-9]{5} ready$/);
});

test('a join link (/g/KEY) serves the same app', async ({ page }) => {
  await page.goto('/g/ABCDE');
  await expect(page.getByRole('heading', { name: 'drinkinggame' })).toBeVisible();
  await expect(page.getByTestId('path')).toHaveText('/g/ABCDE');
  await expect(page.getByTestId('server')).toHaveText(/^lobby [A-Z0-9]{5} ready$/);
});
