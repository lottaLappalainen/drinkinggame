// The app works under the production CSP (public/_headers) — no violation anywhere on the way from
// the first paint to a lobby with its QR code.
import { expect, test } from '@playwright/test';

test('no CSP violations: theme script, app, QR chunk, WebSocket', async ({ page }) => {
  const violations: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /CSP|Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });

  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'");
  // The pre-paint script ran (it is allowed only by its hash).
  await expect(page.locator('html')).toHaveAttribute('data-theme', /^(light|dark)$/);

  await page.getByLabel('Nickname').fill('CSP');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Host a game' }).last().click();
  await expect(page.getByRole('img', { name: /Scan to join/ })).toBeVisible(); // lazy chunk + socket
  expect(violations).toEqual([]);
});
