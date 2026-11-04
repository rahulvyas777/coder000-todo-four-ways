// Shared helpers for the measurement scripts. Chrome is always the installed Chrome
// (Playwright channel 'chrome'); Playwright's own browsers are never downloaded or used.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const VIEWPORT = { width: 1366, height: 768 };
// "100ms" network setting: 100 ms RTT, 10 Mbit/s down and up (bytes per second for CDP).
const THROTTLE_100MS = { offline: false, latency: 100, downloadThroughput: 10_000_000 / 8, uploadThroughput: 10_000_000 / 8 };

function parseArgs(defaults) {
  const out = { ...defaults };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  if (out.runs !== undefined) out.runs = Number(out.runs);
  if (out.timeout !== undefined) out.timeout = Number(out.timeout);
  if (typeof out.url === 'string') out.url = out.url.replace(/\/+$/, '');
  return out;
}

function requireArgs(args, names, usage) {
  const missing = names.filter((n) => !args[n] || args[n] === true);
  if (missing.length) {
    console.error(`Missing ${missing.map((m) => '--' + m).join(', ')}\nUsage: ${usage}`);
    process.exit(2);
  }
}

async function launchChrome(args) {
  const { chromium } = require('playwright');
  // chromium.launch() gives every launch a fresh temporary profile; extensions are disabled.
  return chromium.launch({
    channel: 'chrome',
    headless: !args.headed,
    args: [`--window-size=${VIEWPORT.width},${VIEWPORT.height}`],
  });
}

function newContext(browser, extra = {}) {
  return browser.newContext({ viewport: VIEWPORT, screen: VIEWPORT, ...extra });
}

async function applyThrottle(cdp, mode) {
  if (!mode || mode === 'none') return null;
  if (mode !== '100ms') throw new Error(`unknown --throttle ${mode} (none|100ms)`);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', THROTTLE_100MS);
  return THROTTLE_100MS;
}

function stats(values) {
  const v = values.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, median: null, min: null, max: null };
  const mid = Math.floor(v.length / 2);
  const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, median: round(median), min: round(v[0]), max: round(v[v.length - 1]) };
}

function round(x, d = 2) {
  if (typeof x !== 'number' || !Number.isFinite(x)) return x;
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

// Absolute paths in the recorded arguments are reduced to their file name, so no user folder
// ends up in a published JSON file.
function scrubArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args)) out[k] = typeof v === 'string' && path.isAbsolute(v) ? path.basename(v) : v;
  return out;
}

function meta(script, args, chromeVersion, extra = {}) {
  args = scrubArgs(args);
  return {
    script,
    timestamp: new Date().toISOString(),
    chrome: chromeVersion || null,
    node: process.version,
    playwright: pkgVersion('playwright'),
    platform: `${os.type()} ${os.release()}`,
    viewport: VIEWPORT,
    args,
    ...extra,
  };
}

function pkgVersion(name) {
  try { return require(`${name}/package.json`).version; } catch { return null; }
}

function writeJson(file, obj) {
  if (!file || file === true) return;
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

// Waits for a selector to be visible; never throws. Returns { ok, ms, error }.
async function waitVisible(page, selector, timeout) {
  const t0 = Date.now();
  try {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: `not found within ${timeout} ms: ${selector}` };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { VIEWPORT, THROTTLE_100MS, parseArgs, requireArgs, launchChrome, newContext, applyThrottle, stats, round, meta, pkgVersion, writeJson, waitVisible, sleep };
