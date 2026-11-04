import { test, expect, gotoList } from '../fixtures';
import type { Page } from '@playwright/test';

const theme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('tasks-theme'));

test.describe('Step 11: Dark mode', { tag: '@step11' }, () => {
  test('first load follows prefers-color-scheme when nothing is stored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await gotoList(page, 1);
    await expect.poll(() => theme(page)).toBe('dark');
    const darkBg = await bodyBg(page);

    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => localStorage.removeItem('tasks-theme'));
    await page.reload();
    await expect(page.getByTestId('rows-container')).toBeVisible();
    await expect.poll(() => theme(page)).toBe('light');
    // The attribute alone proves nothing: the page must actually change colour.
    expect(await bodyBg(page)).not.toBe(darkBg);
  });

  test('theme-toggle switches data-theme, the colours, and persists in localStorage', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoList(page, 1);
    await expect.poll(() => theme(page)).toBe('light');
    const lightBg = await bodyBg(page);

    await page.getByTestId('theme-toggle').click();
    await expect.poll(() => theme(page)).toBe('dark');
    await expect.poll(() => bodyBg(page)).not.toBe(lightBg);
    expect(await stored(page)).toBe('dark');

    // The stored value beats the system preference on the next load.
    await page.reload();
    await expect(page.getByTestId('rows-container')).toBeVisible();
    await expect.poll(() => theme(page)).toBe('dark');
    await expect.poll(() => bodyBg(page)).not.toBe(lightBg);

    await page.getByTestId('theme-toggle').click();
    await expect.poll(() => theme(page)).toBe('light');
    await expect.poll(() => bodyBg(page)).toBe(lightBg);
    expect(await stored(page)).toBe('light');
  });
});
