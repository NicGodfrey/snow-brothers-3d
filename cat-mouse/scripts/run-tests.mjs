#!/usr/bin/env node
/**
 * `node --test <dir>` is unreliable here: dist-test is CommonJS (so the
 * compiled tests can `require()`) while the package root is ESM, and the
 * /exec-daemon node wrapper does not recurse directories or accept isolation
 * flags. Collect *.test.js and run them with a real Node binary.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'dist-test', 'tests');

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function resolveNode() {
  const fromEnv = process.env.NODE_TEST_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const nvmHome = process.env.NVM_DIR || join(process.env.HOME ?? '/home/ubuntu', '.nvm');
  const nvmNode = join(nvmHome, 'versions/node/v22.22.2/bin/node');
  if (existsSync(nvmNode)) return nvmNode;
  const pathEntries = (process.env.PATH ?? '').split(':');
  for (const dir of pathEntries) {
    const candidate = join(dir, 'node');
    if (existsSync(candidate) && !candidate.includes('exec-daemon')) return candidate;
  }
  return process.execPath;
}

let files;
try {
  files = collect(testsDir).sort();
} catch {
  console.error('No compiled tests at dist-test/tests. Run scripts/build-tests.mjs first.');
  process.exit(1);
}

if (files.length === 0) {
  console.error('No *.test.js files found under dist-test/tests.');
  process.exit(1);
}

const nodeBin = resolveNode();
const result = spawnSync(nodeBin, ['--test', ...files], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
process.exit(result.status ?? 1);
