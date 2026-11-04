#!/usr/bin/env node
// circuits.js --url <blazor server base> --pid <server process id> --out <file.json> [--wait 60000] [--pages 10]
// Blazor Server memory per circuit: opens ONE page on <base>/lists/4 (Archive 10k), waits for the
// rows, waits --wait ms, reads the server process WorkingSet64 and PrivateMemorySize64
// (Get-Process); then opens more pages in the same browser until --pages pages (circuits) are
// open, the first one included, waits for rows in each, waits --wait ms and reads again.
// The first page stays open, so the second reading has exactly --pages live circuits (a closed
// page would leave a disconnected circuit retained by the server).
'use strict';
const { execFileSync } = require('child_process');
const { parseArgs, requireArgs, launchChrome, newContext, meta, writeJson, waitVisible, sleep } = require('./lib');

const ROWS = '[data-testid="rows-container"] [data-testid^="task-row-"]';

function readProcess(pid) {
  const cmd = `$p = Get-Process -Id ${Number(pid)}; '{0} {1}' -f $p.WorkingSet64, $p.PrivateMemorySize64`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim().split(/\s+/);
  return { at: new Date().toISOString(), workingSet64: Number(out[0]), privateMemorySize64: Number(out[1]) };
}

async function main() {
  const args = parseArgs({ wait: 60000, pages: 10, timeout: 60000 });
  requireArgs(args, ['url', 'pid', 'out'], 'node circuits.js --url http://localhost:16022 --pid <server pid> --out circuits.json');
  args.wait = Number(args.wait); args.pages = Number(args.pages);
  const before = readProcess(args.pid);
  const browser = await launchChrome(args);
  const chromeVersion = browser.version();
  const readings = [];
  try {
    const context = await newContext(browser);
    const pages = [];
    const open = async () => {
      const page = await context.newPage();
      await page.goto(`${args.url}/lists/4`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
      const r = await waitVisible(page, ROWS, args.timeout);
      const rows = r.ok ? await page.locator(ROWS).count() : 0;
      pages.push(page);
      return { ok: r.ok, ms: r.ms, error: r.error, rowsInDom: rows };
    };
    const first = [await open()];
    await sleep(args.wait);
    readings.push({ circuits: 1, pages: first, ...readProcess(args.pid) });
    const more = [];
    while (pages.length < args.pages) more.push(await open());
    await sleep(args.wait);
    readings.push({ circuits: pages.length, pages: more, ...readProcess(args.pid) });
    await context.close();
  } finally {
    await browser.close();
  }
  const after = readProcess(args.pid);
  const res = { meta: meta('circuits.js', args, chromeVersion, { pidRead: 'Get-Process -Id <pid>: WorkingSet64, PrivateMemorySize64' }), beforeBrowser: before, readings, afterBrowserClosed: after };
  writeJson(args.out, res);
  for (const r of readings) console.log(`circuits ${r.circuits}: working set ${r.workingSet64} bytes, private ${r.privateMemorySize64} bytes at ${r.at}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
