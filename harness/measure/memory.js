#!/usr/bin/env node
// memory.js --url <base> --out <file.json> [--runs 3] [--idle 5000] [--timeout 30000] [--headed]
// Opens <base>/lists/4 (Archive 10k) in a fresh browser, waits for the rows, idles, forces a GC
// (CDP HeapProfiler.collectGarbage) and reads CDP Performance.getMetrics: JSHeapUsedSize,
// JSHeapTotalSize, Nodes, Documents, JSEventListeners. Neither number is the tab's whole process
// memory. For Blazor WebAssembly it also reads the WebAssembly linear memory size:
//   1. globalThis.getDotnetRuntime(0).Module.HEAPU8.byteLength (the .NET runtime API), else
//   2. the byteLength of every WebAssembly.Memory the page created or exported (an init script
//      wraps the WebAssembly.Memory constructor and instantiate/instantiateStreaming), else
//   3. the size of the .wasm downloads (resource timing) - NOT memory, flagged as such.
// "wasm.method" says which one was used.
'use strict';
const { parseArgs, requireArgs, launchChrome, newContext, stats, meta, writeJson, waitVisible, sleep } = require('./lib');

const WASM_INIT = `(() => {
  const W = globalThis.WebAssembly;
  if (!W) return;
  const seen = [];
  globalThis.__wasmMemories = seen;
  const Orig = W.Memory;
  try {
    W.Memory = new Proxy(Orig, { construct(target, argList, newTarget) { const m = Reflect.construct(target, argList, newTarget); seen.push(m); return m; } });
  } catch (e) {}
  const grab = (res) => {
    try {
      const inst = res && (res.instance || res);
      const ex = inst && inst.exports;
      if (ex) for (const k of Object.keys(ex)) if (ex[k] instanceof Orig && !seen.includes(ex[k])) seen.push(ex[k]);
    } catch (e) {}
    return res;
  };
  for (const fn of ['instantiate', 'instantiateStreaming']) {
    const o = W[fn];
    if (typeof o === 'function') W[fn] = function () { return o.apply(this, arguments).then(grab); };
  }
})();`;

async function wasmMemory(page) {
  return page.evaluate(() => {
    try {
      const rt = typeof globalThis.getDotnetRuntime === 'function' ? globalThis.getDotnetRuntime(0) : null;
      const n = rt && rt.Module && rt.Module.HEAPU8 ? rt.Module.HEAPU8.byteLength : null;
      if (n) return { method: 'getDotnetRuntime(0).Module.HEAPU8.byteLength', bytes: n };
    } catch (e) { /* fall through */ }
    const mems = globalThis.__wasmMemories || [];
    if (mems.length) {
      const sizes = mems.map((m) => { try { return m.buffer.byteLength; } catch (e) { return 0; } });
      return { method: 'WebAssembly.Memory buffer byteLength (constructor/instantiate hook)', bytes: sizes.reduce((a, b) => a + b, 0), memories: sizes };
    }
    const wasm = performance.getEntriesByType('resource').filter((r) => /\.wasm(\?|$)/i.test(r.name));
    if (wasm.length) {
      return { method: 'fallback: .wasm download size from resource timing (not memory)', bytes: null, wasmDecodedBytes: wasm.reduce((a, r) => a + (r.decodedBodySize || 0), 0), wasmTransferBytes: wasm.reduce((a, r) => a + (r.transferSize || 0), 0), files: wasm.length };
    }
    return { method: 'none: no WebAssembly on this page', bytes: null };
  });
}

async function main() {
  const args = parseArgs({ runs: 3, idle: 5000, timeout: 30000 });
  requireArgs(args, ['url', 'out'], 'node memory.js --url http://localhost:16012 --out memory.json [--runs 3]');
  const runs = [];
  let chromeVersion = null;
  for (let i = 0; i < args.runs; i++) {
    const browser = await launchChrome(args);
    chromeVersion = browser.version();
    try {
      const context = await newContext(browser);
      await context.addInitScript(WASM_INIT);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await page.goto(`${args.url}/lists/4`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
      const w = await waitVisible(page, '[data-testid="rows-container"] [data-testid^="task-row-"]', args.timeout);
      await sleep(Number(args.idle));
      await cdp.send('HeapProfiler.collectGarbage');
      await sleep(500);
      const { metrics } = await cdp.send('Performance.getMetrics');
      const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
      const rowsInDom = await page.locator('[data-testid="rows-container"] [data-testid^="task-row-"]').count().catch(() => null);
      const countText = await page.locator('[data-testid="task-count"]').first().textContent({ timeout: 1000 }).catch(() => null);
      runs.push({
        run: i + 1, rowsVisible: w.ok, error: w.error,
        JSHeapUsedSize: m.JSHeapUsedSize, JSHeapTotalSize: m.JSHeapTotalSize, Nodes: m.Nodes, Documents: m.Documents, JSEventListeners: m.JSEventListeners,
        rowsInDom, countText, wasm: await wasmMemory(page),
      });
      await context.close();
    } finally {
      await browser.close();
    }
  }
  const pick = (k) => stats(runs.map((r) => r[k]));
  const summary = {
    JSHeapUsedSize: pick('JSHeapUsedSize'), JSHeapTotalSize: pick('JSHeapTotalSize'), Nodes: pick('Nodes'),
    Documents: pick('Documents'), JSEventListeners: pick('JSEventListeners'),
    wasmBytes: stats(runs.map((r) => r.wasm && r.wasm.bytes)), wasmMethod: [...new Set(runs.map((r) => r.wasm && r.wasm.method))],
    rowsVisibleAllRuns: runs.every((r) => r.rowsVisible),
  };
  writeJson(args.out, { meta: meta('memory.js', args, chromeVersion, { note: 'JS heap and DOM counters from CDP Performance.getMetrics after HeapProfiler.collectGarbage; not the tab process memory' }), summary, runs });
  const mb = (s) => (s.median === null ? 'n/a' : (s.median / 1048576).toFixed(1) + ' MB');
  console.log(`memory ${args.url}/lists/4 runs=${args.runs}: JS heap used ${mb(summary.JSHeapUsedSize)}, total ${mb(summary.JSHeapTotalSize)}, DOM nodes ${summary.Nodes.median}, wasm ${mb(summary.wasmBytes)} (${summary.wasmMethod.join('; ')}); rows ${summary.rowsVisibleAllRuns ? 'visible' : 'NOT FOUND'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
