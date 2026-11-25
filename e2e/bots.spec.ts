// Test bots (dev / staging only): one phone hosts, adds bots from the 🤖 sheet and plays with them.
// Delete this file together with src/client/dev/bots/ when the bots are removed.
import { expect, test, type Page } from '@playwright/test';

async function hostGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await page.getByLabel('Nickname').fill('Host');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Host a game' }).last().click();
  await expect(page).toHaveURL(/\/g\/[A-Z0-9]{5}$/);
}

async function addBots(page: Page, count: number, speed: 'Fast' | 'Normal' | 'Slow' | 'Never') {
  await page.getByRole('button', { name: /^Test bots/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Test bots' });
  for (let i = 5; i > count; i--) await sheet.getByRole('button', { name: 'Fewer' }).click();
  await sheet.getByRole('radio', { name: speed }).click();
  await sheet.getByRole('button', { name: `Add ${String(count)} bots` }).click();
  return sheet;
}

/** Fill every spot (tap a player, then a spot) and press Ready. */
async function answer(page: Page) {
  await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const pool = page.getByRole('list', { name: 'Players to place' });
  const spots = page.getByRole('list', { name: 'Your ranking' }).getByRole('button');
  const count = await spots.count();
  for (let spot = 0; spot < count; spot++) {
    await pool.getByRole('button').first().click();
    await spots.nth(spot).click();
  }
  await page.getByRole('button', { name: 'Ready', exact: true }).click();
}

test('add bots in the lobby: they join with the given names and play two questions', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await hostGame(page);
  const sheet = await addBots(page, 3, 'Fast');
  for (const name of ['anni1', 'anni4', 'iidalotta'])
    await expect(sheet.getByText(new RegExp(`🤖 ${name}: in the lobby`))).toBeVisible({
      timeout: 15_000,
    });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: '4 players' })).toBeVisible();

  await page.getByRole('button', { name: 'Start game' }).click();
  for (let round = 1; round <= 2; round++) {
    await answer(page);
    // The bots answer by themselves (Fast: 1–3 s), so the round ends without waiting 30 s.
    await expect(page.getByRole('heading', { name: 'The full ranking' })).toBeVisible({
      timeout: 25_000,
    });
    const ranking = page.getByRole('list', { name: 'The full ranking' });
    await expect(ranking.getByRole('listitem')).toHaveCount(4);
    if (round === 1) await page.getByRole('button', { name: 'Next question' }).click();
  }
});

test('"Remove all bots" makes them leave the game', async ({ page }) => {
  test.setTimeout(60_000);
  await hostGame(page);
  const sheet = await addBots(page, 2, 'Normal');
  await expect(sheet.getByText(/🤖 anni4: in the lobby/)).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole('button', { name: 'Remove all bots' }).click();
  await expect(sheet.getByText(/🤖 anni1/)).toHaveCount(0, { timeout: 15_000 });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: '1 player' })).toBeVisible();
});
