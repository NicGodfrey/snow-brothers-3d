#!/usr/bin/env node
/**
 * Reports the line-count policy from SPEC.md: src/**\/*.ts and tests/**\/*.ts,
 * excluding node_modules, build output and lockfiles.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-test', '.git', '.vite']);
const ROOTS = ['src', 'tests'];

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = [];
for (const r of ROOTS) walk(join(root, r), files);
files.sort();

const groups = new Map();
let total = 0;
let code = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  total += lines.length;
  for (const line of lines) {
    const t = line.trim();
    if (t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    code += 1;
  }
  const rel = relative(root, file);
  const group = rel.split('/').slice(0, 2).join('/');
  const g = groups.get(group) ?? { files: 0, lines: 0 };
  g.files += 1;
  g.lines += lines.length;
  groups.set(group, g);
}

const width = Math.max(...[...groups.keys()].map((k) => k.length), 12);
console.log('Cat & Mouse — line count\n');
for (const [group, g] of [...groups.entries()].sort((a, b) => b[1].lines - a[1].lines)) {
  console.log(`  ${group.padEnd(width)}  ${String(g.lines).padStart(7)} lines  ${String(g.files).padStart(4)} files`);
}
console.log(`\n  ${'TOTAL'.padEnd(width)}  ${String(total).padStart(7)} lines  ${String(files.length).padStart(4)} files`);
console.log(`  ${'non-blank/non-comment'.padEnd(width)}  ${String(code).padStart(7)} lines`);

const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
console.log(`  ${'bytes'.padEnd(width)}  ${String(bytes).padStart(7)}`);
