#!/usr/bin/env node
// Helper for devmetrics.ps1 (JSON and file walking are easier and safer in Node than in
// Windows PowerShell 5.1). Every subcommand prints one JSON object.
//   node devmetrics-helper.js npmdeps <package.json> <npm-ls.json>
//   node devmetrics-helper.js dotnetdeps <dotnet-list-package.json>
//   node devmetrics-helper.js nugetsize <obj/project.assets.json>
//   node devmetrics-helper.js dirsize <folder>
//   node devmetrics-helper.js loc <folder>          (non-blank lines and files by extension)
//   node devmetrics-helper.js cloc <cloc.json>      (cloc --json output, summarised)
'use strict';
const fs = require('fs');
const path = require('path');

const EXCLUDE_DIRS = new Set(['node_modules', 'bin', 'obj', 'dist', '.angular', 'e2e', 'shared', 'publish', '.git', '.vs', '.vscode', 'test-results', 'playwright-report', 'Migrations']);
const CODE_EXT = new Set(['.cs', '.razor', '.cshtml', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.scss']);

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

function dirSize(dir) {
  let bytes = 0, files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { bytes += fs.statSync(p).size; files++; } catch { /* vanished */ } }
    }
  }
  return { bytes, files };
}

function walkSource(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    const norm = r.split(path.sep).join('/');
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      if (/(^|\/)wwwroot\/lib$/i.test(norm)) continue;
      out.push(...walkSource(root, r));
    } else if (e.isFile()) {
      if (/package-lock\.json$|\.Designer\.cs$|\.(br|gz)$/i.test(e.name)) continue;
      out.push(norm);
    }
  }
  return out;
}

const cmd = process.argv[2];
const a = process.argv.slice(3);
let result;
switch (cmd) {
  case 'npmdeps': {
    const pkg = readJson(a[0]);
    const direct = Object.keys(pkg.dependencies || {}).length;
    const directDev = Object.keys(pkg.devDependencies || {}).length;
    const seen = new Set();
    const visit = (node) => {
      for (const [name, d] of Object.entries(node.dependencies || {})) {
        const key = `${name}@${d.version || '?'}`;
        if (seen.has(key)) continue;
        seen.add(key);
        visit(d);
      }
    };
    let lsError = null;
    try { visit(readJson(a[1])); } catch (e) { lsError = String(e.message); }
    result = { direct, directDev, directTotal: direct + directDev, total: seen.size, uniqueNames: new Set([...seen].map((k) => k.slice(0, k.lastIndexOf('@')))).size, lsError };
    break;
  }
  case 'dotnetdeps': {
    const j = readJson(a[0]);
    const top = new Set(), trans = new Set();
    for (const p of j.projects || []) for (const fw of p.frameworks || []) {
      for (const t of fw.topLevelPackages || []) top.add(`${t.id}@${t.resolvedVersion}`);
      for (const t of fw.transitivePackages || []) trans.add(`${t.id}@${t.resolvedVersion}`);
    }
    result = { direct: top.size, transitive: trans.size, total: top.size + trans.size, directPackages: [...top] };
    break;
  }
  case 'nugetsize': {
    const assets = readJson(a[0]);
    const folders = Object.keys(assets.packageFolders || {});
    let bytes = 0, packages = 0, missing = 0;
    for (const [, lib] of Object.entries(assets.libraries || {})) {
      if (lib.type !== 'package') continue;
      packages++;
      const folder = folders.map((f) => path.join(f, lib.path)).find((p) => fs.existsSync(p));
      if (!folder) { missing++; continue; }
      bytes += dirSize(folder).bytes;
    }
    // The cache folder itself is a local path; only its count is reported.
    result = { packages, bytes, missing, packageFolders: folders.length };
    break;
  }
  case 'dirsize': result = fs.existsSync(a[0]) ? dirSize(a[0]) : { bytes: 0, files: 0, missing: true }; break;
  case 'loc': {
    const files = walkSource(a[0]);
    const byExt = {};
    let lines = 0, code = 0;
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!CODE_EXT.has(ext)) continue;
      const text = fs.readFileSync(path.join(a[0], f), 'utf8');
      const nonBlank = text.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
      const row = byExt[ext] || (byExt[ext] = { files: 0, nonBlankLines: 0 });
      row.files++; row.nonBlankLines += nonBlank; code++; lines += nonBlank;
    }
    result = { method: 'non-blank lines of source files by extension (helper, not cloc)', sourceFiles: code, nonBlankLines: lines, allFiles: files.length, byExt };
    break;
  }
  case 'cloc': {
    const j = readJson(a[0]);
    const langs = {};
    for (const [k, v] of Object.entries(j)) if (k !== 'header' && k !== 'SUM') langs[k] = { files: v.nFiles, code: v.code, comment: v.comment, blank: v.blank };
    result = { clocVersion: j.header && j.header.cloc_version, languages: langs, sum: j.SUM ? { files: j.SUM.nFiles, code: j.SUM.code, comment: j.SUM.comment, blank: j.SUM.blank } : null };
    break;
  }
  default:
    console.error('usage: node devmetrics-helper.js npmdeps|dotnetdeps|nugetsize|dirsize|loc|cloc ...');
    process.exit(2);
}
process.stdout.write(JSON.stringify(result));
