// End-to-end on emulated phones against the dev server (client + Worker + DO): first visit →
// profile → host; a join link to an unknown game; three phones playing a whole round; and the
// dev screen gallery rendering every fixture.
import { devices, expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';

async function setProfile(page: Page, nickname: string, button = 'Save') {
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await page.getByLabel('Nickname').fill(nickname);
  await page.getByRole('button', { name: button, exact: true }).click();
}

/** Another phone of the same kind as this test's project (iphone / android). */
async function newPhone(browser: Browser, testInfo: TestInfo): Promise<Page> {
  const device = testInfo.project.name === 'iphone' ? devices['iPhone 15'] : devices['Pixel 7'];
  const baseURL = testInfo.project.use.baseURL;
  const context = await browser.newContext({
    ...device,
    ...(baseURL !== undefined && { baseURL }),
  });
  return context.newPage();
}

async function hostGame(page: Page): Promise<string> {
  await page.goto('/');
  await setProfile(page, 'Host');
  await page.getByRole('button', { name: 'Host a game' }).last().click();
  await expect(page).toHaveURL(/\/g\/[A-Z0-9]{5}$/);
  const key = new URL(page.url()).pathname.slice(3);
  await expect(page.getByText(key, { exact: true })).toBeVisible();
  return key;
}

test('first visit: profile, then host a game — the lobby shows the key and the QR code', async ({
  page,
}) => {
  await hostGame(page);
  await expect(page.getByRole('img', { name: /Scan to join/ })).toBeVisible(); // the lazy QR code
  await expect(page.getByRole('heading', { name: '1 player' })).toBeVisible();
});

test('a join link to a game that does not exist says so', async ({ page }) => {
  await page.goto('/g/ABCDE');
  await setProfile(page, 'Visitor', 'Save and join');
  await expect(page.getByRole('heading', { name: 'Game not found' })).toBeVisible();
});

test('three phones play a whole round', async ({ page: host, browser }, testInfo) => {
  test.setTimeout(90_000);
  const key = await hostGame(host);
  const aino = await newPhone(browser, testInfo);
  const ville = await newPhone(browser, testInfo);
  for (const [phone, name] of [
    [aino, 'Aino'],
    [ville, 'Ville'],
  ] as const) {
    await phone.goto(`/g/${key}`);
    await setProfile(phone, name, 'Save and join');
    await expect(phone.getByText('Waiting for the host to start…')).toBeVisible();
  }
  await expect(host.getByRole('heading', { name: '3 players' })).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Mid-game, everyone has the game menu (Leave, the host's Remove / End game — G-41, G-43, G-46).
  await aino.getByRole('button', { name: 'Game menu' }).first().click();
  const menu = aino.getByRole('dialog', { name: 'Game menu' });
  await expect(menu.getByRole('button', { name: 'Leave game' })).toBeVisible();
  await menu.getByRole('button', { name: 'Dismiss' }).click();

  for (const phone of [host, aino, ville]) {
    // Intro (question only), then the answering screen.
    await expect(phone.getByRole('button', { name: 'Ready', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    const pool = phone.getByRole('list', { name: 'Tap a player, then a spot.' });
    const spots = phone.locator('ol li button');
    for (let spot = 0; spot < 3; spot++) {
      await pool.getByRole('button').first().click();
      await spots.nth(spot).click();
    }
    await phone.getByRole('button', { name: 'Ready', exact: true }).click();
  }

  // Everyone ready → results for all at once; the reveal ends on the full ranking.
  for (const phone of [host, aino, ville])
    await expect(phone.getByRole('heading', { name: 'The full ranking' })).toBeVisible({
      timeout: 20_000,
    });
  await expect(host.getByRole('button', { name: 'Next question' })).toBeEnabled();
  await expect(aino.getByText('Waiting for the host…')).toBeVisible();
});

test('the screen gallery renders every fixture without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Fixture players with a photo point at photos no server has: answer with a stand-in image.
  const PNG_1PX =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
  await page.route('**/api/games/*/*/photos/*', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(PNG_1PX, 'base64') }),
  );
  await page.goto('/dev/screens');
  await expect(page.getByText('results-podium-done', { exact: true })).toBeVisible();
  await expect(page.getByText('ended-host-ended', { exact: true })).toBeVisible();
  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: 'dark' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Back after leaving lands on Home — it never joins the game again by itself', async ({
  page: host,
  browser,
}, testInfo) => {
  const key = await hostGame(host);
  const aino = await newPhone(browser, testInfo);
  await aino.goto('/');
  await setProfile(aino, 'Aino');
  await aino.getByLabel('Game key').fill(key);
  await aino.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(aino.getByText('Waiting for the host to start…')).toBeVisible();
  await expect(host.getByRole('heading', { name: '2 players' })).toBeVisible();

  await aino.getByRole('button', { name: 'Leave game' }).click();
  await aino.getByRole('dialog').getByRole('button', { name: 'Leave game' }).click();
  await expect(aino.getByRole('button', { name: 'Host a game' }).last()).toBeVisible();
  await expect(host.getByRole('heading', { name: '1 player' })).toBeVisible();

  await aino.goBack();
  await expect(aino.getByRole('button', { name: 'Host a game' }).last()).toBeVisible();
  // Any history entry that still points at the game (e.g. from before leaving): Back onto it.
  await aino.evaluate((path) => {
    history.pushState(null, '', path);
    history.pushState(null, '', '/');
  }, `/g/${key}`);
  await aino.goBack();
  await expect(aino.getByRole('button', { name: 'Host a game' }).last()).toBeVisible();
  await aino.waitForTimeout(1_000); // give a wrong auto-join time to happen
  await expect(host.getByRole('heading', { name: '1 player' })).toBeVisible();
});
