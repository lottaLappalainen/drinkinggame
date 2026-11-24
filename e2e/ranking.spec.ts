// The ranking board's drag (G-36) on emulated phones, on the ranking test page (/dev/ranking — the
// real question screen with made-up players). Playwright drives it with a mouse pointer; real
// touch (scrolling vs. dragging, iOS edge swipes) is what the phone checkpoint U5 is for.
import { expect, test, type Locator, type Page } from '@playwright/test';

async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('element is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A list tile's player name (its text is the avatar emoji, a line break, then the name). */
async function nameOf(tile: Locator): Promise<string> {
  const lines = (await tile.innerText()).split('\n');
  return (lines.at(-1) ?? '').trim();
}

/**
 * What a finger would touch at the centre of `locator`: the element itself ('ok'), or something
 * pinned on top of it — the spots at the top of the screen ('top') or the Ready bar ('bottom').
 */
async function cover(locator: Locator): Promise<'ok' | 'top' | 'bottom'> {
  const { x, y } = await centerOf(locator);
  return locator.evaluate(
    (element, [px, py]) => {
      const hit = document.elementFromPoint(px ?? 0, py ?? 0);
      if (element.contains(hit)) return 'ok';
      const box = hit?.getBoundingClientRect();
      return box !== undefined && box.top < window.innerHeight / 2 ? 'top' : 'bottom';
    },
    [x, y],
  );
}

/**
 * Scroll until `locator` can be touched. "In view" isn't enough: the pinned spots cover the top of
 * the screen and the pinned Ready bar the bottom, so a list tile can be on screen yet underneath.
 */
async function makeTouchable(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  for (let i = 0; i < 40; i++) {
    const covered = await cover(locator);
    if (covered === 'ok') return;
    // Under the top pin → move the page content down (scroll up); under the bottom bar → up.
    await page.evaluate(
      (dy) => {
        window.scrollBy(0, dy);
      },
      covered === 'top' ? -40 : 40,
    );
  }
  throw new Error('element stays covered');
}

/** A tap where a finger could really reach (not under a pinned bar). */
async function tap(page: Page, locator: Locator) {
  await makeTouchable(page, locator);
  const { x, y } = await centerOf(locator);
  await page.mouse.click(x, y);
}

/** Press on `from`, optionally rest (hold-to-drag), move to `to` in steps, let go. */
async function drag(page: Page, from: Locator, to: Locator, holdMs = 0) {
  // Scroll first, measure after: the spots are pinned, so scrolling moves them on screen. And
  // measure BEFORE pressing — measuring mid-press can take long enough on a busy machine to count
  // as a hold, turning a "quick swipe" into a drag.
  await makeTouchable(page, from);
  await makeTouchable(page, to);
  if ((await cover(from)) !== 'ok') throw new Error('both ends of the drag never fit one screen');
  const start = await centerOf(from);
  const end = await centerOf(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

async function openTestPage(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/ranking');
  // The intro shows the question alone for a few seconds, then the board appears.
  await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  return errors;
}

test('Spotlight: drag players into spots, swap two by dragging, Ready', async ({ page }) => {
  const errors = await openTestPage(page);
  const pool = page.getByRole('list', { name: 'Players to place' });
  const spots = page.getByRole('list', { name: 'Your ranking' }).getByRole('button');

  const first = pool.getByRole('button').first();
  const firstName = await nameOf(first);
  await drag(page, first, spots.nth(0));
  await expect(spots.nth(0)).toContainText(firstName);

  const second = pool.getByRole('button').first();
  const secondName = await nameOf(second);
  await drag(page, second, spots.nth(1));
  await expect(spots.nth(1)).toContainText(secondName);

  // Spot 1 → spot 2: the two swap.
  await drag(page, spots.nth(0), spots.nth(1));
  await expect(spots.nth(0)).toContainText(secondName);
  await expect(spots.nth(1)).toContainText(firstName);

  // A drag that ends is not also a tap: nothing is left selected.
  await expect(pool.getByRole('button', { pressed: true })).toHaveCount(0);

  // Fill the rest by tapping (the other input), then Ready.
  const ready = page.getByRole('button', { name: 'Ready', exact: true });
  for (let spot = 2; spot < 6; spot++) {
    await tap(page, pool.getByRole('button').first());
    await tap(page, spots.nth(spot));
  }
  await expect(ready).toBeEnabled();
  await ready.click();
  await expect(page.getByRole('heading', { name: 'Waiting for the others…' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Podium: the long list needs press-and-hold; a quick swipe does not drag', async ({
  page,
}) => {
  const errors = await openTestPage(page);
  await page.getByRole('radio', { name: '12' }).click();
  await page.getByRole('radio', { name: 'Podium' }).click();
  await expect(page.getByRole('button', { name: 'Ready', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  const pool = page.getByRole('list', { name: 'Players to place' });
  const spots = page.getByRole('list', { name: 'Your ranking' }).getByRole('button');
  await expect(spots).toHaveCount(3);

  const candidate = pool.getByRole('button').nth(5);
  const name = await nameOf(candidate);
  await drag(page, candidate, spots.nth(0)); // no hold → not a drag
  await expect(spots.nth(0)).not.toContainText(name);

  await drag(page, pool.getByRole('button', { name, exact: true }), spots.nth(0), 500); // hold, then drag
  await expect(spots.nth(0)).toContainText(name);

  // Dragged back onto the list → out of the spots again.
  await drag(page, spots.nth(0), pool.getByRole('button').first(), 500); // a tile is part of the list
  await expect(spots.nth(0)).not.toContainText(name);
  expect(errors).toEqual([]);
});
