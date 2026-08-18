#!/usr/bin/env node
/**
 * Compiles src + tests to CommonJS under dist-test so `node --test` can run
 * them without a loader. The package itself is ESM, so dist-test needs its own
 * package.json marking the emitted .js files as CommonJS.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(root, 'dist-test');

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tsc)) {
  console.error('typescript is not installed. Run `npm install` first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.test.json')], {
  cwd: root,
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

console.log('tests compiled to dist-test/');
