/**
 * Runtime loader for compiled modules under dist-test/src.
 * Static imports of files that do not exist yet would fail the whole tsc emit;
 * these helpers fail the individual test instead.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const req = createRequire(__filename);

export function compiledSrcPath(relFromSrc: string): string {
  return join(__dirname, '..', '..', 'src', relFromSrc);
}

export function tryLoadSrc<T extends object>(relFromSrc: string): T | null {
  const base = compiledSrcPath(relFromSrc.replace(/\.ts$/, ''));
  const candidates = [base + '.js', base, join(base, 'index.js')];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return req(candidate) as T;
  }
  return null;
}

export function loadSrc<T extends object>(relFromSrc: string): T {
  const mod = tryLoadSrc<T>(relFromSrc);
  assert.ok(
    mod,
    `missing compiled module src/${relFromSrc} — write the implementation against the public contracts`,
  );
  return mod;
}

export function loadFirst<T extends object>(relFromSrcList: readonly string[]): T {
  const tried: string[] = [];
  for (const rel of relFromSrcList) {
    const mod = tryLoadSrc<T>(rel);
    if (mod) return mod;
    tried.push(`src/${rel}`);
  }
  assert.fail(
    `missing implementation. tried: ${tried.join(', ')}. export the public contract from one of those paths.`,
  );
}

export function exportNames(mod: object): string[] {
  return Object.keys(mod).sort();
}

export function pickExport<T>(mod: object, names: readonly string[]): T | undefined {
  const record = mod as Record<string, unknown>;
  for (const name of names) {
    if (name in record && record[name] !== undefined) return record[name] as T;
  }
  return undefined;
}
