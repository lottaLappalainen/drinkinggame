// End-to-end photo pipeline (G-2, CLAUDE.md §6 "Avatars — photos") in the real browser engines:
// a picked picture is cropped and shrunk on the phone, saved with the profile, uploaded after
// hosting and shown in the lobby from the server's photo URL — at 192 × 192. WebKit (the iphone
// project) can't write WebP, so it also exercises the JPEG fallback. An unreadable file keeps the
// emoji and says so.
import { expect, test, type Page } from '@playwright/test';

/** A 300 × 200 PNG drawn in the page — a non-square picture, so the crop matters. */
async function pngBytes(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300;
    canvas.height = 200;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('no 2d context');
    context.fillStyle = 'rgb(200, 40, 90)';
    context.fillRect(0, 0, 300, 200);
    context.fillStyle = 'rgb(240, 200, 60)';
    context.fillRect(100, 50, 100, 100);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  });
  return Buffer.from(base64, 'base64');
}

const galleryInput = (page: Page) => page.locator('input[type="file"]:not([capture])');

test('a chosen photo is shrunk, uploaded after hosting and shown in the lobby', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Who are you?' })).toBeVisible();
  await expect(page.locator('input[type="file"][capture="user"]')).toHaveCount(1); // "Take selfie"
  await page.getByLabel('Nickname').fill('Photo');
  await galleryInput(page).setInputFiles({
    name: 'me.png',
    mimeType: 'image/png',
    buffer: await pngBytes(page),
  });
  await expect(page.getByText(/Using your photo/)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await page.getByRole('button', { name: 'Host a game' }).last().click();
  await expect(page).toHaveURL(/\/g\/[A-Z0-9]{5}$/);

  // The lobby's player list loads our photo from the server (version 1), not the local copy.
  const photo = page.locator('img[src*="/photos/"]').first();
  await expect(photo).toHaveAttribute('src', /\/api\/games\/[A-Z0-9]{5}\/\w+\/photos\/\w+\?v=1$/);
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(192);
  expect(await photo.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(192);
});

test('an unreadable picture keeps the emoji and says why', async ({ page }) => {
  await page.goto('/');
  await galleryInput(page).setInputFiles({
    name: 'photo.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('not really an image'),
  });
  await expect(page.getByRole('alert')).toHaveText(/can't read that picture/);
  await expect(page.getByText(/Using your photo/)).toHaveCount(0);
});
