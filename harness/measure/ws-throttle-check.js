#!/usr/bin/env node
// ws-throttle-check.js --url <blazor server base> --out <file.json> [--n 20] [--api <api base>]
// Does CDP Network.emulateNetworkConditions (100 ms latency, 10 Mbit/s, the "100ms" setting of
// lib.js) delay Blazor Server's WebSocket frames? Opens <base>/lists/1 in a fresh browser and,
// unthrottled and then throttled (same page, conditions applied through CDP):
//   - times --n HTTP round trips to the page's own origin: fetch('/?ws-check=<i>', no-store);
//   - times --n Blazor round trips: click the checkbox of the first row and wait until the
//     server's re-render changes the page (the row's class attribute, the task-count text, or the
//     row leaving the list), performance.now() around it; the WebSocket frame count is read from
//     CDP Network.webSocketFrameSent/Received to show the round trip went over the socket.
// --api <base>: POST <base>/api/admin/reset before each phase.
'use strict';
const { parseArgs, requireArgs, launchChrome, newContext, applyThrottle, stats, meta, writeJson, waitVisible, sleep, THROTTLE_100MS } = require('./lib');

const ROWS = '[data-testid="rows-container"] [data-testid^="task-row-"]';
const COUNT = '[data-testid="task-count"]';

async function reset(api) { if (api) await fetch(`${api.replace(/\/+$/, '')}/api/admin/reset`, { method: 'POST' }).catch(() => {}); }

async function phase(page, cdp, n, frames) {
  const http = [];
  for (let i = 0; i < n; i++) {
    http.push(await page.evaluate(async (i) => {
      const t0 = performance.now();
      const r = await fetch(`/?ws-check=${i}`, { cache: 'no-store' });
      await r.text();
      return performance.now() - t0;
    }, i));
  }
  const blazor = [];
  for (let i = 0; i < n; i++) {
    const f0 = frames.sent + frames.received;
    const r = await page.evaluate(async ({ ROWS, COUNT }) => {
      const row = document.querySelector(ROWS);
      if (!row) return { error: 'no row' };
      const id = row.getAttribute('data-testid').replace('task-row-', '');
      const box = document.querySelector(`[data-testid="task-check-${id}"]`);
      if (!box) return { error: 'no checkbox' };
      const cls0 = row.getAttribute('class');
      const cnt = document.querySelector(COUNT);
      const count0 = cnt ? cnt.textContent : null;
      const changed = () => !row.isConnected || row.getAttribute('class') !== cls0 || (cnt && cnt.textContent !== count0);
      return await new Promise((resolve) => {
        const t0 = performance.now();
        const done = (how) => { obs.disconnect(); resolve({ ms: performance.now() - t0, how, id }); };
        const obs = new MutationObserver(() => { if (changed()) done('mutation'); });
        obs.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => done('timeout 10000 ms'), 10000);
        box.click();
      });
    }, { ROWS, COUNT });
    await sleep(150);
    r.framesDuring = frames.sent + frames.received - f0;
    blazor.push(r);
  }
  return {
    httpMs: http.map((x) => Math.round(x * 10) / 10), http: stats(http),
    blazor, blazorStats: stats(blazor.filter((b) => b.how === 'mutation').map((b) => b.ms)),
  };
}

async function main() {
  const args = parseArgs({ n: 20, timeout: 30000 });
  requireArgs(args, ['url', 'out'], 'node ws-throttle-check.js --url http://localhost:16022 --out websocket-throttle-check.json --api http://localhost:16020');
  args.n = Number(args.n);
  const browser = await launchChrome(args);
  const chromeVersion = browser.version();
  const res = { meta: meta('ws-throttle-check.js', args, chromeVersion, { throttle100ms: THROTTLE_100MS }) };
  try {
    await reset(args.api);
    const context = await newContext(browser);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    const frames = { sent: 0, received: 0 };
    cdp.on('Network.webSocketFrameSent', () => frames.sent++);
    cdp.on('Network.webSocketFrameReceived', () => frames.received++);
    await page.goto(`${args.url}/lists/1`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
    const r = await waitVisible(page, ROWS, args.timeout);
    if (!r.ok) throw new Error(r.error);
    await sleep(1500);
    res.unthrottled = await phase(page, cdp, args.n, frames);
    await reset(args.api);
    await page.reload({ waitUntil: 'commit' });
    await waitVisible(page, ROWS, args.timeout);
    await sleep(1500);
    await applyThrottle(cdp, '100ms');
    res.throttled = await phase(page, cdp, args.n, frames);
    res.framesTotal = frames;
    await context.close();
  } finally {
    await browser.close();
    await reset(args.api);
  }
  const u = res.unthrottled, t = res.throttled;
  res.verdict = {
    httpMedianGrowMs: Math.round((t.http.median - u.http.median) * 10) / 10,
    blazorMedianGrowMs: (t.blazorStats.median !== null && u.blazorStats.median !== null) ? Math.round((t.blazorStats.median - u.blazorStats.median) * 10) / 10 : null,
  };
  writeJson(args.out, res);
  console.log(`http median ${u.http.median} -> ${t.http.median} ms; blazor round trip median ${u.blazorStats.median} -> ${t.blazorStats.median} ms (n ${u.blazorStats.n}/${t.blazorStats.n}); frames ${JSON.stringify(res.framesTotal)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
