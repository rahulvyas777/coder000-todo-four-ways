#!/usr/bin/env node
// axe.js --url <base> --out <file.json> [--timeout 15000] [--headed]
// Runs axe-core (through @axe-core/playwright) in four states: <base>/lists/1, the detail panel
// open (click the first row), the shortcut dialog open (Escape, then "?"), and <base>/lists/4.
// A state that could not be reached is still scanned and marked reached: false.
'use strict';
const { parseArgs, requireArgs, launchChrome, newContext, meta, writeJson, waitVisible, sleep, pkgVersion } = require('./lib');

const ROWS = '[data-testid="rows-container"] [data-testid^="task-row-"], [data-testid^="task-row-"]';

async function scan(page, name, reached, note) {
  const { default: AxeBuilder } = require('@axe-core/playwright');
  try {
    const r = await new AxeBuilder({ page }).analyze();
    const violations = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help }));
    const byImpact = {};
    for (const v of violations) byImpact[v.impact || 'unknown'] = (byImpact[v.impact || 'unknown'] || 0) + 1;
    return { name, reached, note, url: page.url().replace(/^https?:\/\/[^/]+/, ''), violations, byImpact, passes: r.passes.length, incomplete: r.incomplete.length, axe: r.testEngine && r.testEngine.version };
  } catch (e) {
    return { name, reached, note, error: String(e.message).split('\n')[0] };
  }
}

async function main() {
  const args = parseArgs({ timeout: 15000 });
  requireArgs(args, ['url', 'out'], 'node axe.js --url http://localhost:16012 --out axe.json');
  const browser = await launchChrome(args);
  const chromeVersion = browser.version();
  const states = [];
  try {
    const context = await newContext(browser);
    const page = await context.newPage();
    const T = args.timeout;

    await page.goto(`${args.url}/lists/1`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
    const rows = await waitVisible(page, ROWS, Math.max(T, 30000));
    await sleep(300);
    states.push(await scan(page, 'lists-1', rows.ok, rows.error));

    let panel = { ok: false, error: 'no row to click' };
    if (rows.ok) {
      await page.locator(ROWS).first().click({ timeout: T }).catch(() => {});
      panel = await waitVisible(page, '[data-testid="task-panel"]', T);
    }
    await sleep(300);
    states.push(await scan(page, 'panel-open', panel.ok, panel.error));

    await page.keyboard.press('Escape').catch(() => {});
    await sleep(300);
    // Shortcuts are ignored while typing in an input, so move focus off any input first.
    await page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }).catch(() => {});
    await page.keyboard.press('?').catch(() => {});
    const help = await waitVisible(page, '[data-testid="shortcut-help"]', T);
    await sleep(300);
    states.push(await scan(page, 'shortcut-help', help.ok, help.error));

    await page.goto(`${args.url}/lists/4`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
    const big = await waitVisible(page, ROWS, Math.max(T, 30000));
    await sleep(500);
    states.push(await scan(page, 'lists-4', big.ok, big.error));
    await context.close();
  } finally {
    await browser.close();
  }
  writeJson(args.out, { meta: meta('axe.js', args, chromeVersion, { axeCorePlaywright: pkgVersion('@axe-core/playwright'), axeCore: pkgVersion('axe-core') }), states });
  console.log(`axe ${args.url}: ` + states.map((s) => `${s.name}${s.reached ? '' : ' (not reached)'} ${s.error ? 'error' : s.violations.length + ' rules (' + Object.entries(s.byImpact).map(([k, v]) => k + ' ' + v).join(', ') + ')'}`).join('; '));
}

main().catch((e) => { console.error(e); process.exit(1); });
