// Compares the data-testid names in SPEC.md's test-id table with the ones the suite uses.
// Usage: node check-testids.mjs <path to SPEC.md>
// A template id such as `task-row-{id}` matches the suite's `task-row-${...}` and /^task-row-\d+$/.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: node check-testids.mjs <SPEC.md>');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));

// 1. Spec ids: backticked names in the rows of the "| Area | Test ids |" table.
const spec = readFileSync(specPath, 'utf8').split(/\r?\n/);
const start = spec.findIndex((l) => /^\|\s*Area\s*\|\s*Test ids\s*\|/.test(l));
if (start < 0) {
  console.error('test-id table not found in ' + specPath);
  process.exit(2);
}
const specIds = new Set();
for (let i = start + 2; i < spec.length && spec[i].startsWith('|'); i++) {
  const cells = spec[i].split('|');
  for (const m of (cells[2] || '').matchAll(/`([^`]+)`/g)) specIds.add(m[1]);
}
// Normalise every {placeholder} to {}.
const norm = (s) => s.replace(/\{[^}]*\}/g, '{}');
const specNorm = new Map([...specIds].map((s) => [norm(s), s]));

// 2. Suite ids: getByTestId('x'), getByTestId(`x-${y}`), getByTestId(/^x-\d+$/).
const files = [join(here, 'fixtures.ts'), ...readdirSync(join(here, 'tests')).filter((f) => f.endsWith('.ts')).map((f) => join(here, 'tests', f))];
const used = new Map(); // normalised id -> files
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/getByTestId\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`|\/\^?([^/]+?)\$?\/)/g)) {
    let id;
    if (m[1] || m[2]) id = m[1] || m[2];
    else if (m[3]) id = m[3].replace(/\$\{[^}]*\}/g, '{}');
    else id = m[4].replace(/\\d\+/g, '{}');
    id = norm(id);
    if (!used.has(id)) used.set(id, new Set());
    used.get(id).add(f.slice(here.length + 1).replace(/\\/g, '/'));
  }
  // rowIdsInOrder reads task-row-{id} by attribute in fixtures.ts.
  if (/data-testid\^="task-row-"/.test(src)) {
    if (!used.has('task-row-{}')) used.set('task-row-{}', new Set());
    used.get('task-row-{}').add(f.slice(here.length + 1).replace(/\\/g, '/'));
  }
}

// A spec template `{}` stands for any non-empty value; a dynamic suite id `{}` likewise.
// Two ids match when either one, read as a pattern, matches the other.
const toRe = (s) => new RegExp('^' + s.split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$');
const matches = (a, b) => a === b || toRe(a).test(b) || toRe(b).test(a);
// Concrete ids win: a suite id is matched to the most specific spec id (fewest placeholders).
const specKeys = [...specNorm.keys()].sort((a, b) => a.split('{}').length - b.split('{}').length);
const usedKeys = [...used.keys()];
const covered = new Set();
const unknown = [];
for (const u of usedKeys) {
  const hits = specKeys.filter((s) => matches(s, u));
  if (hits.length === 0) unknown.push(u);
  // A literal suite id covers its one best spec id; a dynamic one (with {}) covers every spec id it matches.
  if (u.includes('{}')) hits.forEach((h) => covered.add(h));
  else if (hits.length) covered.add(hits.find((h) => h === u) ?? hits[0]);
}
const unused = specKeys.filter((k) => !covered.has(k)).map((k) => specNorm.get(k));

console.log(`spec: ${specPath.replace(/\\/g, '/').split('/').slice(-1)[0]}, ${specIds.size} test ids in the table`);
console.log(`suite: ${files.length} files, ${used.size} distinct test ids used`);
console.log(`in the spec but used by no test (${unused.length}): ${unused.join(', ') || 'none'}`);
console.log(`used by a test but not in the spec (${unknown.length}): ${unknown.join(', ') || 'none'}`);
process.exit(unused.length || unknown.length ? 1 : 0);
