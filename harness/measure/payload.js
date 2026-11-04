#!/usr/bin/env node
// payload.js --url <base> --out <file.json> [--runs 1] [--throttle none|100ms] [--timeout 30000] [--headed]
// Cold first load of <base>/lists/1 in a fresh profile, then a warm reload in the same context.
// Bytes are CDP Network.loadingFinished encodedDataLength (what crossed the wire, headers
// included), summed by resource type and by origin (app vs API). WebSocket frames (Blazor Server)
// are counted separately because they never produce loadingFinished. "readyMs" is navigation
// start to the first visible task row (rAF poll in the page).
'use strict';
const { parseArgs, requireArgs, launchChrome, newContext, applyThrottle, stats, meta, writeJson, waitVisible, sleep } = require('./lib');

const READY_INIT = `(() => {
  window.__ready = null;
  const check = () => {
    if (window.__ready !== null) return true;
    const el = document.querySelector('[data-testid^="task-row-"]');
    if (el) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { window.__ready = performance.now(); return true; } }
    return false;
  };
  const loop = () => { if (!check()) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();`;

function tracker(cdp, appOrigin) {
  const reqs = new Map();
  let inflight = 0;
  let lastActivity = Date.now();
  const ws = { framesReceived: 0, bytesReceived: 0, framesSent: 0, bytesSent: 0 };
  cdp.on('Network.requestWillBeSent', (e) => {
    if (!reqs.has(e.requestId)) inflight++;
    reqs.set(e.requestId, { url: e.request.url, type: e.type || 'Other', method: e.request.method, encoded: 0, status: null, fromCache: false, done: false });
    lastActivity = Date.now();
  });
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId);
    if (r) { r.status = e.response.status; r.mime = e.response.mimeType; r.fromCache = !!(e.response.fromDiskCache || e.response.fromServiceWorker || e.response.fromPrefetchCache); r.encoding = (e.response.headers && (e.response.headers['content-encoding'] || e.response.headers['Content-Encoding'])) || null; if (e.type) r.type = e.type; }
  });
  cdp.on('Network.requestServedFromCache', (e) => { const r = reqs.get(e.requestId); if (r) r.fromCache = true; });
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (r && !r.done) { r.encoded = e.encodedDataLength; r.done = true; inflight--; }
    lastActivity = Date.now();
  });
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId);
    if (r && !r.done) { r.failed = e.errorText; r.done = true; inflight--; }
    lastActivity = Date.now();
  });
  cdp.on('Network.webSocketFrameReceived', (e) => { ws.framesReceived++; ws.bytesReceived += Buffer.byteLength(e.response.payloadData || ''); });
  cdp.on('Network.webSocketFrameSent', (e) => { ws.framesSent++; ws.bytesSent += Buffer.byteLength(e.response.payloadData || ''); });
  return {
    reset() { reqs.clear(); inflight = 0; ws.framesReceived = ws.bytesReceived = ws.framesSent = ws.bytesSent = 0; lastActivity = Date.now(); },
    async idle(quietMs = 500, maxMs = 5000) {
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        if (inflight <= 0 && Date.now() - lastActivity >= quietMs) return true;
        await sleep(50);
      }
      return false;
    },
    summary() {
      const list = [...reqs.values()];
      const byType = {};
      const byOrigin = { app: { requests: 0, bytes: 0 }, other: { requests: 0, bytes: 0 } };
      let bytes = 0;
      for (const r of list) {
        const t = byType[r.type] || (byType[r.type] = { requests: 0, bytes: 0 });
        t.requests++; t.bytes += r.encoded; bytes += r.encoded;
        let origin = 'other';
        try { origin = new URL(r.url).origin === appOrigin ? 'app' : 'other'; } catch { /* data: urls */ }
        byOrigin[origin].requests++; byOrigin[origin].bytes += r.encoded;
      }
      return {
        requests: list.length,
        bytes,
        byType,
        byOrigin,
        fromCache: list.filter((r) => r.fromCache).length,
        failed: list.filter((r) => r.failed).length,
        websocket: { ...ws },
        list: list.map((r) => ({ url: r.url, type: r.type, method: r.method, status: r.status, encoded: r.encoded, encoding: r.encoding || null, fromCache: r.fromCache, failed: r.failed || undefined })),
      };
    },
  };
}

async function measureLoad(page, cdp, tr, action, args) {
  tr.reset();
  await action();
  const wait = await waitVisible(page, '[data-testid="task-row-1"]', args.timeout);
  const settled = await tr.idle();
  const readyMs = await page.evaluate(() => window.__ready).catch(() => null);
  return { rowVisible: wait.ok, error: wait.error, readyMs, networkSettled: settled, ...tr.summary() };
}

async function main() {
  const args = parseArgs({ runs: 1, throttle: 'none', timeout: 30000 });
  requireArgs(args, ['url', 'out'], 'node payload.js --url http://localhost:16012 --out payload.json [--runs 5] [--throttle none|100ms]');
  const runs = [];
  let chromeVersion = null;
  for (let i = 0; i < args.runs; i++) {
    const browser = await launchChrome(args);
    chromeVersion = browser.version();
    try {
      const context = await newContext(browser);
      await context.addInitScript(READY_INIT);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      const throttle = await applyThrottle(cdp, args.throttle);
      const tr = tracker(cdp, new URL(args.url).origin);
      const cold = await measureLoad(page, cdp, tr, () => page.goto(`${args.url}/lists/1`, { waitUntil: 'commit', timeout: args.timeout }).catch((e) => e), args);
      const warm = await measureLoad(page, cdp, tr, () => page.reload({ waitUntil: 'commit', timeout: args.timeout }).catch((e) => e), args);
      runs.push({ run: i + 1, throttle, cold, warm });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  const pick = (k, f) => stats(runs.map((r) => f(r[k])));
  const summary = {
    cold: { requests: pick('cold', (x) => x.requests), bytes: pick('cold', (x) => x.bytes), appBytes: pick('cold', (x) => x.byOrigin.app.bytes), readyMs: pick('cold', (x) => x.readyMs) },
    warm: { requests: pick('warm', (x) => x.requests), bytes: pick('warm', (x) => x.bytes), appBytes: pick('warm', (x) => x.byOrigin.app.bytes), readyMs: pick('warm', (x) => x.readyMs) },
    rowVisibleAllRuns: runs.every((r) => r.cold.rowVisible && r.warm.rowVisible),
  };
  writeJson(args.out, { meta: meta('payload.js', args, chromeVersion), summary, runs });
  const c = summary.cold;
  console.log(`payload ${args.url} throttle=${args.throttle} runs=${args.runs}: cold ${c.requests.median} requests ${c.bytes.median} bytes (app ${c.appBytes.median}), ready ${c.readyMs.median} ms; warm ${summary.warm.requests.median} requests ${summary.warm.bytes.median} bytes; rows ${summary.rowVisibleAllRuns ? 'visible' : 'NOT FOUND'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
