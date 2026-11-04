#!/usr/bin/env node
// interact.js --url <base> --out <file.json> [--runs 5] [--throttle none|100ms] [--api <api base>]
//             [--timeout 15000] [--headed]
// Interactions on "Archive 10k", one fresh browser (fresh profile) per run.
//
// How a duration is measured: before each action the page is "armed" with the DOM condition the
// action should cause (a text change, an element appearing, ...). A capturing listener records the
// timestamp of the first input event after arming (event.timeStamp: keydown, pointerdown, click,
// wheel, input or change). A MutationObserver plus a rAF poll notices when the condition holds;
// the "paint" time is taken in a setTimeout(0) queued from the next requestAnimationFrame, i.e.
// just after the frame that shows the change. durationMs = paint - input. The pair is also
// written as performance.mark("<step>:start"/"<step>:end") and performance.measure("<step>").
// Event Timing entries (PerformanceObserver type "event", durationThreshold 16) are collected
// too: eventMs is the longest entry that started with the input (input to next paint, as Chrome
// reports it; entries under 16 ms are not reported by the browser, so eventMs is then null).
//
// --api <base>: POST <base>/api/admin/reset before every run, so every run starts from the seed
// (toggling a task changes the data). Without it the runs share whatever state the API has.
// An element that does not appear within --timeout is recorded as { ok: false, error } and the
// script carries on with the next interaction instead of throwing.
'use strict';
const { parseArgs, requireArgs, launchChrome, newContext, applyThrottle, stats, round, meta, writeJson, waitVisible, sleep } = require('./lib');

const ROWS = '[data-testid="rows-container"] [data-testid^="task-row-"]';
const COUNT = '[data-testid="task-count"]';
const SEARCH_TEXT = 'ticket 0999';

const INIT = `(() => {
  window.__events = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        let target = null;
        try { target = e.target && e.target.getAttribute ? e.target.getAttribute('data-testid') : null; } catch (x) {}
        window.__events.push({ name: e.name, startTime: e.startTime, duration: e.duration, processingStart: e.processingStart, processingEnd: e.processingEnd, interactionId: e.interactionId || 0, target });
      }
    }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  } catch (err) { window.__eventsError = String(err); }

  window.__probe = null;
  for (const t of ['keydown', 'pointerdown', 'mousedown', 'click', 'wheel', 'input', 'change']) {
    window.addEventListener(t, (ev) => {
      const p = window.__probe;
      if (p && p.inputTs === null) { p.inputTs = ev.timeStamp; p.inputType = t; }
    }, { capture: true, passive: true });
  }
  const visible = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const textOf = (sel) => { const el = document.querySelector(sel); return el ? el.textContent : null; };
  const classOf = (sel) => { const el = document.querySelector(sel); return el ? el.getAttribute('class') : null; };
  const test = (c) => {
    switch (c.kind) {
      case 'visible': return visible(document.querySelector(c.sel));
      case 'hidden': return !visible(document.querySelector(c.sel));
      case 'text': return textOf(c.sel) !== c.base;
      case 'includes': { const t = textOf(c.sel); return t !== null && t.includes(c.value); }
      case 'class': return classOf(c.sel) !== c.base;
      case 'mutation': return c.mutated === true;
      default: return false;
    }
  };
  window.__arm = (name, conds) => {
    const p = { name, conds: conds.map((c) => Object.assign({}, c)), inputTs: null, inputType: null, changeTs: null, paintTs: null, met: null };
    for (const c of p.conds) { if (c.kind === 'text') c.base = textOf(c.sel); if (c.kind === 'class') c.base = classOf(c.sel); }
    const check = () => {
      if (p.changeTs !== null || p.inputTs === null) return;
      for (let i = 0; i < p.conds.length; i++) {
        if (test(p.conds[i])) {
          p.changeTs = performance.now(); p.met = p.conds[i].kind + ' ' + p.conds[i].sel;
          mo.disconnect();
          requestAnimationFrame(() => setTimeout(() => {
            p.paintTs = performance.now();
            try {
              performance.mark(name + ':start', { startTime: p.inputTs });
              performance.mark(name + ':end', { startTime: p.paintTs });
              performance.measure(name, name + ':start', name + ':end');
            } catch (x) {}
          }, 0));
          return;
        }
      }
    };
    const mo = new MutationObserver((records) => {
      if (p.inputTs !== null) {
        for (const c of p.conds) {
          if (c.kind !== 'mutation') continue;
          const root = document.querySelector(c.sel);
          if (root && records.some((r) => root.contains(r.target))) c.mutated = true;
        }
      }
      check();
    });
    mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    const poll = () => { if (p.changeTs === null) { check(); requestAnimationFrame(poll); } };
    requestAnimationFrame(poll);
    window.__probe = p;
    return true;
  };
  // Continuous recorder for the typing sequence: every keydown time, and every change of the
  // watched texts with the time of the paint that follows it.
  window.__rec = null;
  window.addEventListener('keydown', (ev) => { const r = window.__rec; if (r && r.active) r.keys.push(ev.timeStamp); }, { capture: true, passive: true });
  window.__startRec = (sels) => {
    const r = { active: true, sels, keys: [], changes: [] };
    r.last = sels.map(textOf);
    r.mo = new MutationObserver(() => {
      const t = r.sels.map(textOf);
      if (t.some((x, i) => x !== r.last[i])) {
        r.last = t;
        const change = performance.now();
        requestAnimationFrame(() => setTimeout(() => r.changes.push({ change, paint: performance.now(), texts: t.map((x) => (x === null ? null : x.slice(0, 60))) }), 0));
      }
    });
    r.mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    window.__rec = r;
    return true;
  };
  window.__recState = () => { const r = window.__rec; return r ? { keys: r.keys.slice(), changes: r.changes.slice() } : null; };
  window.__stopRec = () => { const r = window.__rec; if (!r) return null; r.active = false; r.mo.disconnect(); return { keys: r.keys, changes: r.changes }; };
  window.__probeResult = () => { const p = window.__probe; return p ? { inputTs: p.inputTs, inputType: p.inputType, changeTs: p.changeTs, paintTs: p.paintTs, met: p.met } : null; };
  window.__eventsBetween = (a, b) => (window.__events || []).filter((e) => e.startTime >= a - 2 && e.startTime <= b);
})();`;

// One measured interaction. Never throws.
async function measure(page, name, conds, action, { wait, settle = 150 }) {
  const out = { name, ok: false, changed: false };
  try {
    await page.evaluate(([n, c]) => window.__arm(n, c), [name, conds]);
    await action();
    try {
      await page.waitForFunction(() => { const r = window.__probeResult(); return r && r.paintTs !== null; }, null, { timeout: wait, polling: 16 });
      out.changed = true;
    } catch { /* no change within the wait */ }
    await sleep(settle);
    const r = await page.evaluate(() => window.__probeResult());
    out.ok = true;
    out.inputType = r.inputType;
    out.met = r.met;
    out.inputTs = round(r.inputTs);
    out.durationMs = r.inputTs !== null && r.paintTs !== null ? round(r.paintTs - r.inputTs) : null;
    out.toChangeMs = r.inputTs !== null && r.changeTs !== null ? round(r.changeTs - r.inputTs) : null;
    if (r.inputTs !== null) {
      const end = r.paintTs !== null ? r.paintTs + 50 : r.inputTs + wait;
      const evs = await page.evaluate(([a, b]) => window.__eventsBetween(a, b), [r.inputTs, end]);
      const top = evs.reduce((m, e) => (!m || e.duration > m.duration ? e : m), null);
      out.eventMs = top ? top.duration : null;
      out.eventName = top ? top.name : null;
      out.eventEntries = evs.length;
    } else {
      out.error = 'no input event reached the page';
    }
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).split('\n')[0];
  }
  return out;
}

async function need(page, selector, timeout) {
  const w = await waitVisible(page, selector, timeout);
  return w.ok ? null : { ok: false, error: w.error };
}

async function firstRowId(page) {
  const tid = await page.locator(ROWS).first().getAttribute('data-testid', { timeout: 2000 }).catch(() => null);
  return tid ? tid.slice('task-row-'.length) : null;
}

async function oneRun(args, runNo) {
  if (args.api) {
    const r = await fetch(`${String(args.api).replace(/\/+$/, '')}/api/admin/reset`, { method: 'POST' }).catch((e) => ({ status: String(e) }));
    if (r.status !== 204) throw new Error(`API reset failed: ${r.status}`);
  }
  const browser = await launchChrome(args);
  const run = { run: runNo, chrome: browser.version(), steps: {} };
  const T = args.timeout;
  try {
    const context = await newContext(browser);
    await context.addInitScript(INIT);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    run.throttle = await applyThrottle(cdp, args.throttle);
    const S = run.steps;

    await page.goto(`${args.url}/lists/1`, { waitUntil: 'commit', timeout: 60000 }).catch((e) => { run.gotoError = String(e.message).split('\n')[0]; });
    const load = await waitVisible(page, ROWS, Math.max(T, 30000));
    S.load = { ok: load.ok, ms: load.ms, error: load.error };
    run.eventTimingSupported = await page.evaluate(() => !window.__eventsError).catch(() => false);
    await sleep(500);

    // 1. Select Archive 10k: click to the first "Ticket" row. When the list item holds a link the
    //    link is clicked (the centre of the item can be its rename/delete buttons), else the item.
    const item = page.locator('[data-testid="list-item-4"]').first();
    S.selectList = (await need(page, '[data-testid="list-item-4"]', T)) ||
      await measure(page, 'selectList', [{ sel: ROWS, kind: 'includes', value: 'Ticket' }],
        async () => {
          const link = item.locator('a[href]').first();
          if (await link.count()) await link.click(); else await item.click();
        }, { wait: 60000, settle: 1000 });
    S.selectList.countText = await page.locator(COUNT).first().textContent({ timeout: 1000 }).catch(() => null);

    // 2. Type "ticket 0999" one key at a time, 300 ms apart.
    const miss = await need(page, '[data-testid="search-input"]', T);
    if (miss) { S.search = miss; S.clearSearch = { ok: false, error: 'skipped: no search-input' }; }
    else {
      // Keys are typed at a steady 300 ms cadence while a recorder in the page logs every keydown
      // and every change of task-count or the first row's text (with the paint after it). A change
      // belongs to the last key typed before it; a key with no change before the next key shows
      // nothing new (for example "t" when every title contains "ticket"). After the last key the
      // script waits until nothing has changed for 1 s (at most 15 s).
      await page.locator('[data-testid="search-input"]').first().click();
      await sleep(300);
      await page.evaluate((sels) => window.__startRec(sels), [COUNT, ROWS]);
      for (const ch of SEARCH_TEXT) { await page.keyboard.type(ch); await sleep(300); }
      const waitStart = Date.now();
      let lastCount = -1, stableSince = Date.now();
      while (Date.now() - waitStart < 15000) {
        const st = await page.evaluate(() => window.__recState());
        if (st.changes.length !== lastCount) { lastCount = st.changes.length; stableSince = Date.now(); }
        if (Date.now() - stableSince >= 1000) break;
        await sleep(100);
      }
      const rec = await page.evaluate(() => window.__stopRec());
      const evs = await page.evaluate(() => window.__events || []);
      const keys = [];
      for (let i = 0; i < SEARCH_TEXT.length; i++) {
        const t = rec.keys[i];
        const next = rec.keys[i + 1] === undefined ? Infinity : rec.keys[i + 1];
        if (t === undefined) { keys.push({ key: SEARCH_TEXT[i], ok: false, error: 'keydown not seen by the page' }); continue; }
        const mine = rec.changes.filter((c) => c.change >= t && c.change < next);
        const lastC = mine[mine.length - 1];
        const ke = evs.filter((e) => e.startTime >= t - 2 && e.startTime < Math.min(next, t + 1000));
        const top = ke.reduce((m, e) => (!m || e.duration > m.duration ? e : m), null);
        keys.push({
          key: SEARCH_TEXT[i], ok: true, inputTs: round(t), changed: !!lastC,
          durationMs: lastC ? round(lastC.paint - t) : null, changes: mine.length,
          eventMs: top ? top.duration : null, eventName: top ? top.name : null,
        });
      }
      const lastChange = rec.changes[rec.changes.length - 1];
      S.search = {
        ok: rec.keys.length === SEARCH_TEXT.length,
        keys,
        totalMs: rec.keys.length && lastChange ? round(lastChange.paint - rec.keys[0]) : null,
        typingMs: rec.keys.length > 1 ? round(rec.keys[rec.keys.length - 1] - rec.keys[0]) : null,
        keysChanged: keys.filter((k) => k.changed).length,
        finalTexts: lastChange ? lastChange.texts : null,
        countText: await page.locator(COUNT).first().textContent({ timeout: 1000 }).catch(() => null),
      };
      await sleep(500);

      // 3. Clear the search: select all, then Backspace (measured from the Backspace).
      await page.keyboard.press('Control+A');
      S.clearSearch = await measure(page, 'clearSearch', [{ sel: COUNT, kind: 'text' }, { sel: ROWS, kind: 'text' }],
        () => page.keyboard.press('Backspace'), { wait: 15000, settle: 500 });
    }

    // 4. Sort by title and back to manual. On Archive 10k the title order equals the manual order
    //    (zero-padded ticket numbers), so the first row may not change: a DOM mutation inside the
    //    rows container also counts, and "changed: false" is a valid outcome. sortDue is an extra
    //    pair whose first row does change.
    const sortMiss = await need(page, '[data-testid="sort-select"]', T);
    for (const [name, value, conds, wait] of [
      ['sortTitle', 'title', [{ sel: ROWS, kind: 'text' }, { sel: '[data-testid="rows-container"]', kind: 'mutation' }], 3000],
      ['sortManual', 'manual', [{ sel: ROWS, kind: 'text' }, { sel: '[data-testid="rows-container"]', kind: 'mutation' }], 3000],
      ['sortDue', 'due', [{ sel: ROWS, kind: 'text' }], 15000],
      ['sortDueBack', 'manual', [{ sel: ROWS, kind: 'text' }], 15000],
    ]) {
      S[name] = sortMiss || await measure(page, name, conds,
        () => page.locator('[data-testid="sort-select"]').first().selectOption(value), { wait, settle: 300 });
    }

    // 5. Toggle the first visible row's checkbox.
    const id1 = await firstRowId(page);
    if (!id1) S.toggle = { ok: false, error: 'no task row in rows-container' };
    else {
      const sel = `[data-testid="task-check-${id1}"]`;
      S.toggle = (await need(page, sel, T)) ||
        await measure(page, 'toggle', [{ sel: `[data-testid="task-row-${id1}"]`, kind: 'class' }, { sel: `[data-testid="task-row-${id1}"]`, kind: 'hidden' }, { sel: COUNT, kind: 'text' }],
          () => page.locator(sel).first().click(), { wait: 15000, settle: 500 });
      S.toggle.taskId = id1;
    }

    // 6. Open the panel by clicking the first visible row, then close it with Escape.
    const id2 = await firstRowId(page);
    if (!id2) { S.panelOpen = { ok: false, error: 'no task row in rows-container' }; S.panelClose = { ok: false, error: 'skipped' }; }
    else {
      S.panelOpen = await measure(page, 'panelOpen', [{ sel: '[data-testid="task-panel"]', kind: 'visible' }],
        () => page.locator(`[data-testid="task-row-${id2}"]`).first().click({ timeout: T }), { wait: T, settle: 300 });
      S.panelOpen.taskId = id2;
      if (S.panelOpen.changed) {
        S.panelClose = await measure(page, 'panelClose', [{ sel: '[data-testid="task-panel"]', kind: 'hidden' }],
          () => page.keyboard.press('Escape'), { wait: T, settle: 300 });
      } else {
        S.panelOpen.error = S.panelOpen.error || `task-panel not visible within ${T} ms`;
        S.panelClose = { ok: false, error: 'skipped: the panel did not open' };
        await page.keyboard.press('Escape').catch(() => {});
      }
    }

    // 7. Select all, then Escape clears the selection.
    const selMiss = await need(page, '[data-testid="select-all"]', T);
    if (selMiss) { S.selectAll = selMiss; S.selectClear = { ok: false, error: 'skipped' }; }
    else {
      S.selectAll = await measure(page, 'selectAll', [{ sel: '[data-testid="bulk-bar"]', kind: 'visible' }],
        () => page.locator('[data-testid="select-all"]').first().click(), { wait: T, settle: 300 });
      S.selectClear = await measure(page, 'selectClear', [{ sel: '[data-testid="bulk-bar"]', kind: 'hidden' }],
        () => page.keyboard.press('Escape'), { wait: T, settle: 300 });
    }

    // 8. Scroll: 40 wheel ticks of 400 px, 50 ms apart; frames counted with requestAnimationFrame.
    const scMiss = await need(page, '[data-testid="rows-container"]', T);
    if (scMiss) S.scroll = scMiss;
    else {
      const box = await page.locator('[data-testid="rows-container"]').first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
      const before = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="rows-container"]');
        window.__frames = []; window.__counting = true;
        const loop = (t) => { if (!window.__counting) return; window.__frames.push(t); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
        return { scrollTop: c.scrollTop, scrollHeight: c.scrollHeight, rows: c.querySelectorAll('[data-testid^="task-row-"]').length };
      });
      const tStart = await page.evaluate(() => performance.now());
      for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 400); await sleep(50); }
      await sleep(100);
      const after = await page.evaluate((t0) => {
        window.__counting = false;
        const c = document.querySelector('[data-testid="rows-container"]');
        const f = window.__frames.filter((x) => x >= t0);
        let maxGap = 0;
        for (let i = 1; i < f.length; i++) maxGap = Math.max(maxGap, f[i] - f[i - 1]);
        const end = performance.now();
        const first = c.querySelector('[data-testid^="task-row-"]');
        return { frames: f.length, elapsedMs: end - t0, maxFrameGapMs: maxGap, scrollTop: c.scrollTop, rows: c.querySelectorAll('[data-testid^="task-row-"]').length, firstRowText: first ? first.textContent.slice(0, 60) : null };
      }, tStart);
      S.scroll = {
        ok: true, ticks: 40, deltaY: 400,
        fps: round(after.frames / (after.elapsedMs / 1000)),
        frames: after.frames, elapsedMs: round(after.elapsedMs), maxFrameGapMs: round(after.maxFrameGapMs),
        scrollTopBefore: before.scrollTop, scrollTopAfter: after.scrollTop, scrollHeight: before.scrollHeight,
        rowsInDomBefore: before.rows, rowsInDomAfter: after.rows, firstRowTextAfter: after.firstRowText,
      };
    }

    run.measures = await page.evaluate(() => performance.getEntriesByType('measure').map((m) => ({ name: m.name, startTime: m.startTime, duration: m.duration }))).catch(() => []);
    run.events = await page.evaluate(() => window.__events).catch(() => []);
    await context.close();
  } finally {
    await browser.close();
  }
  return run;
}

function summarise(runs) {
  const names = ['selectList', 'clearSearch', 'sortTitle', 'sortManual', 'sortDue', 'sortDueBack', 'toggle', 'panelOpen', 'panelClose', 'selectAll', 'selectClear'];
  const s = {};
  for (const n of names) {
    const steps = runs.map((r) => r.steps[n]).filter(Boolean);
    s[n] = {
      durationMs: stats(steps.map((x) => (x.changed ? x.durationMs : null))),
      eventMs: stats(steps.map((x) => x.eventMs)),
      changedRuns: steps.filter((x) => x.changed).length,
      failedRuns: steps.filter((x) => !x.ok).length,
      errors: [...new Set(steps.map((x) => x.error).filter(Boolean))],
    };
  }
  const searches = runs.map((r) => r.steps.search).filter((x) => x && x.keys);
  s.search = {
    totalMs: stats(searches.map((x) => x.totalMs)),
    perKeyMs: stats(searches.flatMap((x) => x.keys.filter((k) => k.changed).map((k) => k.durationMs))),
    perKeyEventMs: stats(searches.flatMap((x) => x.keys.map((k) => k.eventMs))),
    failedRuns: runs.length - searches.length,
    errors: [...new Set(runs.map((r) => r.steps.search && r.steps.search.error).filter(Boolean))],
  };
  const scrolls = runs.map((r) => r.steps.scroll).filter((x) => x && x.ok);
  s.scroll = { fps: stats(scrolls.map((x) => x.fps)), maxFrameGapMs: stats(scrolls.map((x) => x.maxFrameGapMs)), failedRuns: runs.length - scrolls.length };
  s.load = { ms: stats(runs.map((r) => (r.steps.load && r.steps.load.ok ? r.steps.load.ms : null))), failedRuns: runs.filter((r) => !(r.steps.load && r.steps.load.ok)).length };
  return s;
}

async function main() {
  const args = parseArgs({ runs: 5, throttle: 'none', timeout: 15000 });
  requireArgs(args, ['url', 'out'], 'node interact.js --url http://localhost:16012 --out interact.json [--runs 5] [--throttle none|100ms] [--api http://localhost:16010]');
  const runs = [];
  for (let i = 0; i < args.runs; i++) runs.push(await oneRun(args, i + 1));
  const summary = summarise(runs);
  writeJson(args.out, { meta: meta('interact.js', args, runs[0] && runs[0].chrome, { searchText: SEARCH_TEXT, method: 'input event timeStamp to setTimeout(0) after the next rAF following the DOM change; Event Timing durationThreshold 16' }), summary, runs });
  const m = (x) => (x && x.median !== null ? x.median : 'n/a');
  const failed = Object.entries(summary).filter(([, v]) => v.failedRuns > 0).map(([k]) => k);
  console.log(`interact ${args.url} throttle=${args.throttle} runs=${args.runs}: selectList ${m(summary.selectList.durationMs)} ms, search total ${m(summary.search.totalMs)} ms (per key ${m(summary.search.perKeyMs)}), toggle ${m(summary.toggle.durationMs)} ms, panel ${m(summary.panelOpen.durationMs)} ms, selectAll ${m(summary.selectAll.durationMs)} ms, scroll ${m(summary.scroll.fps)} fps; not found: ${failed.length ? failed.join(', ') : 'none'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
