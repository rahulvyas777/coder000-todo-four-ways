// shots.js --out <folder> [--headed]
// Real screenshots of every production host for the posts: Chrome (channel 'chrome', fresh
// profile) at 1366x768, /lists/1 with the detail panel of the first row open, in light and dark
// (the app's own theme-toggle button, so the stored "tasks-theme" value is what a user would
// have), and the Archive 10k list scrolled a little. Files: <client>-light.png, <client>-dark.png,
// <client>-10k.png. Nothing is cropped except the viewport itself.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'shots';
const headed = args.includes('--headed');
fs.mkdirSync(out, { recursive: true });

const clients = [
  { name: 'reference', url: 'http://localhost:16052' },
  { name: 'react', url: 'http://localhost:16032' },
  { name: 'angular', url: 'http://localhost:16042' },
  { name: 'blazor-wasm', url: 'http://localhost:16012' },
  { name: 'blazor-server', url: 'http://localhost:16022' },
];
const ROW = '[data-testid="rows-container"] [data-testid^="task-row-"]';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
  for (const c of clients) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'light' });
    const page = await context.newPage();
    const log = [];
    try {
      await page.goto(c.url + '/lists/1', { waitUntil: 'load' });
      await page.locator(ROW).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(800);
      const first = page.locator(ROW).first();
      await first.locator('[data-testid^="task-title-"]').first().click();
      await page.locator('[data-testid="task-panel"]').waitFor({ timeout: 10000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(out, c.name + '-light.png') });
      log.push('light: panel open on the first row');
      await page.locator('[data-testid="theme-toggle"]').click();
      await page.waitForTimeout(600);
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.screenshot({ path: path.join(out, c.name + '-dark.png') });
      log.push('dark: data-theme=' + theme);
      await page.locator('[data-testid="list-item-4"]').click();
      await page.locator(ROW).first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      await page.locator('[data-testid="rows-container"]').evaluate((el) => { el.scrollTop = 40 * 5000; });
      await page.waitForTimeout(1200);
      const rows = await page.locator(ROW).count();
      const count = await page.locator('[data-testid="task-count"]').textContent();
      await page.screenshot({ path: path.join(out, c.name + '-10k.png') });
      log.push('10k: rows in DOM ' + rows + ', count "' + (count || '').trim() + '", scrolled to row 5000, still dark');
    } catch (e) {
      log.push('ERROR ' + e.message.split('\n')[0]);
    }
    console.log(c.name + ': ' + log.join('; '));
    await context.close();
  }
  await browser.close();
})();
