#!/usr/bin/env node
// Helper for run-step.ps1 (JSON and git output are safer to handle in Node than in Windows
// PowerShell 5.1).
//   node runner-helper.js verdict <playwright-report.json>
//   node runner-helper.js depsdiff <git dir> <pre rev> <post rev>
//   node runner-helper.js line <facts.json>      -> one sessions.jsonl line on stdout
// facts.json (written by run-step.ps1): client, step, stepName, run, tag, result, wallMs,
// timedOut, transcript, verdictJson, verdictExit, gitDir, preCommit, postCommit, gitMode,
// testEdit (array of paths), budgetUsd, timeoutMinutes, allowedTools, disallowedTools,
// startedAt, finishedAt, fcRoot.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parse } = require('./parse-session');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

function scrub(s, fcRoot) {
  if (typeof s !== 'string') return s;
  let out = s;
  if (fcRoot) {
    for (const v of [fcRoot, fcRoot.replace(/\\/g, '/'), fcRoot.replace(/\\/g, '\\\\')]) out = out.split(v).join('<fc>');
  }
  return out.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/"'\s]+/g, '$1<user>');
}

function verdict(file) {
  const empty = { ok: false, expected: 0, unexpected: 0, flaky: 0, skipped: 0, durationMs: null, failing: [], errors: [] };
  if (!file || !fs.existsSync(file) || fs.statSync(file).size === 0) return { ...empty, errors: ['no Playwright JSON report'] };
  let j;
  try { j = readJson(file); } catch (e) { return { ...empty, errors: ['unreadable Playwright JSON report: ' + e.message] }; }
  const failing = [];
  const walk = (suite, trail) => {
    const t = suite.title ? [...trail, suite.title] : trail;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        if (test.status === 'unexpected' || test.status === 'flaky') {
          const last = (test.results || [])[test.results.length - 1] || {};
          const msg = last.error && (last.error.message || last.error.value);
          failing.push({ title: [...t, spec.title].join(' > '), file: spec.file || suite.file || null, status: test.status, error: msg ? String(msg).split('\n')[0].slice(0, 300) : null });
        }
      }
    }
    for (const s of suite.suites || []) walk(s, t);
  };
  for (const s of j.suites || []) walk(s, []);
  const st = j.stats || {};
  const expected = st.expected || 0, unexpected = st.unexpected || 0, flaky = st.flaky || 0, skipped = st.skipped || 0;
  return {
    ok: unexpected === 0 && expected > 0 && (j.errors || []).length === 0,
    expected, unexpected, flaky, skipped, durationMs: st.duration ?? null,
    failing, errors: (j.errors || []).map((e) => String(e.message || e).split('\n')[0].slice(0, 300)),
  };
}

function git(dir, gitArgs) {
  return execFileSync('git', ['-C', dir, ...gitArgs], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

function depsAt(dir, rev) {
  const deps = {};
  let files = [];
  try { files = git(dir, ['ls-tree', '-r', '--name-only', rev]).split(/\r?\n/).filter(Boolean); } catch { return deps; }
  for (const f of files) {
    if (f.split('/').some((p) => p === 'node_modules' || p === 'e2e')) continue;
    if (path.basename(f) === 'package.json') {
      try {
        const pkg = JSON.parse(git(dir, ['show', `${rev}:${f}`]));
        for (const sect of ['dependencies', 'devDependencies']) for (const [n, v] of Object.entries(pkg[sect] || {})) deps[`npm:${n}`] = { file: f, section: sect, version: v };
      } catch { /* unparsable package.json */ }
    } else if (f.endsWith('.csproj')) {
      const text = git(dir, ['show', `${rev}:${f}`]);
      const re = /<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g;
      let m;
      while ((m = re.exec(text))) deps[`nuget:${m[1]}`] = { file: f, version: m[2] || null };
    }
  }
  return deps;
}

function depsDiff(dir, pre, post) {
  const a = depsAt(dir, pre), b = depsAt(dir, post);
  const added = [], removed = [], changed = [];
  for (const [k, v] of Object.entries(b)) {
    if (!a[k]) added.push({ name: k, version: v.version, file: v.file });
    else if (a[k].version !== v.version) changed.push({ name: k, from: a[k].version, to: v.version });
  }
  for (const [k, v] of Object.entries(a)) if (!b[k]) removed.push({ name: k, version: v.version });
  return { added, removed, changed };
}

function shortstat(dir, pre, post) {
  try {
    const s = git(dir, ['diff', '--shortstat', pre, post]).trim();
    const n = (re) => { const m = re.exec(s); return m ? Number(m[1]) : 0; };
    return { files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?/), deletions: n(/(\d+) deletions?/), text: s };
  } catch { return null; }
}

function line(factsFile) {
  const f = readJson(factsFile);
  const s = fs.existsSync(f.transcript) ? parse(f.transcript) : null;
  const v = f.verdictJson ? verdict(f.verdictJson) : null;
  const gitOk = f.gitMode === 'repo' && f.preCommit && f.postCommit;
  const mu = s && s.modelUsage ? s.modelUsage : null;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  if (mu) for (const m of Object.values(mu)) {
    tokens.input += m.inputTokens || 0; tokens.output += m.outputTokens || 0;
    tokens.cacheRead += m.cacheReadInputTokens || 0; tokens.cacheCreation += m.cacheCreationInputTokens || 0;
  }
  const violations = [];
  if (f.testEdit && f.testEdit.length) violations.push({ kind: 'test_edit', paths: f.testEdit });
  const rl = s ? s.rate_limit.last : null;
  const windows = rl && rl.unifiedWindows ? rl.unifiedWindows : null;
  let resetsAt = rl && rl.resetsAt ? rl.resetsAt : null;
  if (windows) for (const w of Object.values(windows)) if (w && w.utilization >= 1 && w.resetsAt) resetsAt = Math.max(resetsAt || 0, w.resetsAt);
  const out = {
    client: f.client, step: f.step, step_name: f.stepName, run: f.run, tag: f.tag, result: f.result,
    flags: f.flags || [],
    started_at: f.startedAt, finished_at: f.finishedAt, wall_ms: f.wallMs, timed_out: !!f.timedOut,
    budget_usd: f.budgetUsd, timeout_minutes: f.timeoutMinutes,
    verdict: v ? { pass: v.ok, expected: v.expected, unexpected: v.unexpected, flaky: v.flaky, skipped: v.skipped, duration_ms: v.durationMs, failing: v.failing.map((x) => ({ ...x, error: scrub(x.error, f.fcRoot) })), errors: v.errors.map((e) => scrub(e, f.fcRoot)), exit_code: f.verdictExit } : null,
    has_result: s ? s.has_result : false,
    num_turns: s ? s.num_turns : null,
    duration_ms: s ? s.duration_ms : null,
    duration_api_ms: s ? s.duration_api_ms : null,
    total_cost_usd: s ? s.total_cost_usd : null,
    is_error: s ? s.is_error : null,
    result_subtype: s ? s.result_subtype : null,
    terminal_reason: s ? s.terminal_reason : null,
    model: s ? s.model : null,
    tokens, usage: s ? s.usage : null, modelUsage: mu,
    tool_calls: s ? s.tool_calls : {}, tool_calls_total: s ? s.tool_calls_total : 0, tool_errors: s ? s.tool_errors : 0,
    denied: s ? { permission_denials: s.denied.permission_denials, events: s.denied.permission_denied_events, by_tool: s.denied.tools, list: (s.denied.list || []).map((d) => ({ tool: d.tool, target: scrub(d.target, f.fcRoot) })) } : null,
    subagents_started: s ? s.subagents_started : 0,
    git: gitOk ? { pre: f.preCommit, post: f.postCommit, diff: shortstat(f.gitDir, f.preCommit, f.postCommit) } : { mode: f.gitMode, pre: f.preCommit || null },
    dependencies: gitOk ? depsDiff(f.gitDir, f.preCommit, f.postCommit) : null,
    violations,
    rate_limit: s ? { seen: s.rate_limit.seen, limited: s.rate_limited, resets_at: resetsAt, status: rl ? rl.status : null, windows } : null,
    exit_code: s ? s.exit_code : null,
    result_text: s ? scrub(s.result_text, f.fcRoot) : null,
    allowed_tools: f.allowedTools, disallowed_tools: f.disallowedTools,
  };
  return out;
}

const cmd = process.argv[2];
const a = process.argv.slice(3);
if (cmd === 'verdict') process.stdout.write(JSON.stringify(verdict(a[0])));
else if (cmd === 'depsdiff') process.stdout.write(JSON.stringify(depsDiff(a[0], a[1], a[2])));
else if (cmd === 'line') process.stdout.write(JSON.stringify(line(a[0])));
else { console.error('usage: node runner-helper.js verdict|depsdiff|line ...'); process.exit(2); }
