#!/usr/bin/env node
// lighthouse.js --url <base> --out <file.json> [--preset desktop|mobile] [--runs 5] [--path /lists/1] [--headed]
// Lighthouse 13 node API, performance category only, on <base><path>. Mobile uses Lighthouse's
// default config (simulated throttling, Moto G Power emulation); desktop uses its desktop preset.
// The installed Chrome is started by chrome-launcher with a fresh temporary profile per run.
// Every full LHR is saved beside --out as <out>.runN.lhr.json; --out holds per-run metrics and
// medians with min and max.
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, requireArgs, stats, meta, writeJson, pkgVersion } = require('./lib');

const AUDITS = ['first-contentful-paint', 'largest-contentful-paint', 'speed-index', 'total-blocking-time', 'interactive', 'cumulative-layout-shift'];

function chromePath(chromeLauncher) {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = [
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const found = chromeLauncher.Launcher.getInstallations();
  if (found.length) return found[0];
  throw new Error('Installed Chrome not found; set CHROME_PATH');
}

async function browserVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`);
    const j = await r.json();
    return j.Browser || null;
  } catch { return null; }
}

async function main() {
  const args = parseArgs({ runs: 5, preset: 'mobile', path: '/lists/1' });
  requireArgs(args, ['url', 'out'], 'node lighthouse.js --url http://localhost:16012 --out lh-mobile.json --preset mobile|desktop --runs 5');
  if (!['mobile', 'desktop'].includes(args.preset)) { console.error('--preset must be mobile or desktop'); process.exit(2); }
  const { default: lighthouse } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');
  const config = args.preset === 'desktop' ? (await import('lighthouse/core/config/desktop-config.js')).default : undefined;
  const target = args.url + args.path;
  const exe = chromePath(chromeLauncher);
  const runs = [];
  let chromeVersion = null;
  const base = args.out.replace(/\.json$/i, '');

  for (let i = 0; i < args.runs; i++) {
    const flags = ['--no-first-run', '--disable-extensions', '--window-size=1366,768'];
    if (!args.headed) flags.push('--headless=new');
    const chrome = await chromeLauncher.launch({ chromePath: exe, chromeFlags: flags, logLevel: 'silent' });
    try {
      chromeVersion = (await browserVersion(chrome.port)) || chromeVersion;
      const res = await lighthouse(target, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] }, config);
      const lhr = res.lhr;
      const metrics = {};
      for (const id of AUDITS) {
        const a = lhr.audits[id];
        if (a) metrics[id] = { value: a.numericValue ?? null, score: a.score ?? null, display: a.displayValue ?? null };
      }
      const score = lhr.categories.performance ? lhr.categories.performance.score : null;
      const lhrFile = `${base}.run${i + 1}.lhr.json`;
      fs.mkdirSync(path.dirname(path.resolve(lhrFile)), { recursive: true });
      fs.writeFileSync(lhrFile, JSON.stringify(lhr));
      runs.push({
        run: i + 1, score: score === null ? null : Math.round(score * 100), metrics,
        runtimeError: lhr.runtimeError || null, runWarnings: lhr.runWarnings || [],
        lighthouseVersion: lhr.lighthouseVersion, formFactor: lhr.configSettings.formFactor,
        throttlingMethod: lhr.configSettings.throttlingMethod, lhrFile: path.basename(lhrFile),
      });
    } finally {
      await chrome.kill();
    }
  }
  const summary = { score: stats(runs.map((r) => r.score)) };
  for (const id of AUDITS) summary[id] = stats(runs.map((r) => (r.metrics[id] ? r.metrics[id].value : null)));
  writeJson(args.out, {
    meta: meta('lighthouse.js', args, chromeVersion, { lighthouse: pkgVersion('lighthouse'), chromeLauncher: pkgVersion('chrome-launcher'), chromePath: '<installed Chrome>', target: args.path }),
    summary, runs,
  });
  const f = (s) => (s && s.median !== null ? Math.round(s.median) : 'n/a');
  console.log(`lighthouse ${args.preset} ${target} runs=${args.runs}: score ${f(summary.score)} (min ${summary.score.min}, max ${summary.score.max}), FCP ${f(summary['first-contentful-paint'])} ms, LCP ${f(summary['largest-contentful-paint'])} ms, SI ${f(summary['speed-index'])} ms, TBT ${f(summary['total-blocking-time'])} ms`);
}

main().catch((e) => { console.error(e); process.exit(1); });
