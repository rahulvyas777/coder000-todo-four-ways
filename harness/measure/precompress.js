#!/usr/bin/env node
// precompress.js <build folder> [--force] [--json <out.json>]
// Writes <file>.br (Brotli quality 11) and <file>.gz (gzip level 9) next to every file over 1 KB
// whose extension is in EXTENSIONS, so every client is compressed by the same tool at the same
// level. It overwrites any .br/.gz the framework produced itself (Blazor's publish writes its own):
// a .br/.gz is kept only when the manifest .precompress.json in the folder says this tool wrote it
// from the current source (same size and mtime) and the output is still newer than the source.
// Node 22, no dependencies. Prints a table: files, bytes raw, bytes br, bytes gz.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const EXTENSIONS = ['js', 'mjs', 'css', 'html', 'json', 'wasm', 'dat', 'blat', 'svg', 'txt', 'webmanifest', 'pdb', 'map'];
const BINARY = new Set(['wasm', 'dat', 'blat', 'pdb']); // Brotli generic mode; the rest text mode
const MIN_BYTES = 1024;
const MANIFEST = '.precompress.json';

function parseArgs(argv) {
  const a = { root: null, force: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i] === '--json') a.json = argv[++i];
    else if (!a.root) a.root = argv[i];
  }
  return a;
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.root || !fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    console.error('Usage: node precompress.js <build folder> [--force] [--json out.json]');
    process.exit(2);
  }
  const root = path.resolve(args.root);
  const manifestPath = path.join(root, MANIFEST);
  let manifest = {};
  if (!args.force && fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { manifest = {}; }
  }
  const next = {};
  const byExt = {};
  const total = { files: 0, raw: 0, br: 0, gz: 0, written: 0, kept: 0 };
  const started = Date.now();

  for (const file of walk(root)) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!EXTENSIONS.includes(ext)) continue; // .br and .gz themselves are never in the list
    const st = fs.statSync(file);
    if (st.size <= MIN_BYTES) continue;
    const rel = path.relative(root, file).split(path.sep).join('/');
    const key = `${st.size}:${Math.floor(st.mtimeMs)}`;
    const outs = { br: file + '.br', gz: file + '.gz' };
    const prev = manifest[rel];
    const fresh = (o) => fs.existsSync(o) && fs.statSync(o).mtimeMs >= st.mtimeMs;
    let brSize, gzSize;
    if (prev && prev.key === key && fresh(outs.br) && fresh(outs.gz)) {
      brSize = fs.statSync(outs.br).size;
      gzSize = fs.statSync(outs.gz).size;
      total.kept++;
    } else {
      const data = fs.readFileSync(file);
      const br = zlib.brotliCompressSync(data, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
          [zlib.constants.BROTLI_PARAM_MODE]: BINARY.has(ext) ? zlib.constants.BROTLI_MODE_GENERIC : zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
        },
      });
      const gz = zlib.gzipSync(data, { level: 9 });
      fs.writeFileSync(outs.br, br);
      fs.writeFileSync(outs.gz, gz);
      brSize = br.length;
      gzSize = gz.length;
      total.written++;
    }
    next[rel] = { key, br: brSize, gz: gzSize };
    const row = byExt[ext] || (byExt[ext] = { files: 0, raw: 0, br: 0, gz: 0 });
    row.files++; row.raw += st.size; row.br += brSize; row.gz += gzSize;
    total.files++; total.raw += st.size; total.br += brSize; total.gz += gzSize;
  }
  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 1));

  const pad = (s, n) => String(s).padStart(n);
  console.log(`precompress ${root}`);
  console.log(`${'ext'.padEnd(12)}${pad('files', 7)}${pad('bytes raw', 14)}${pad('bytes br', 14)}${pad('bytes gz', 14)}`);
  for (const ext of Object.keys(byExt).sort()) {
    const r = byExt[ext];
    console.log(`${ext.padEnd(12)}${pad(r.files, 7)}${pad(r.raw, 14)}${pad(r.br, 14)}${pad(r.gz, 14)}`);
  }
  console.log(`${'total'.padEnd(12)}${pad(total.files, 7)}${pad(total.raw, 14)}${pad(total.br, 14)}${pad(total.gz, 14)}`);
  console.log(`written ${total.written}, kept ${total.kept}, ${Date.now() - started} ms`);
  if (args.json) {
    fs.writeFileSync(args.json, JSON.stringify({
      meta: { script: 'precompress.js', timestamp: new Date().toISOString(), node: process.version, args: process.argv.slice(2), minBytes: MIN_BYTES, brotliQuality: 11, gzipLevel: 9 },
      byExt, total,
    }, null, 2));
  }
}

main();
