#!/usr/bin/env node
/**
 * Packages the monorepo (no node_modules/dist) into an export archive
 * under /opt/cursor/artifacts and docs/exports.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WORKSPACE = fileURLToPath(new URL("../..", import.meta.url));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const name = `enterprise-suite-${stamp}.tar.gz`;
const outDir = "/opt/cursor/artifacts";
const docsExport = join(ROOT, "docs/exports");
mkdirSync(outDir, { recursive: true });
mkdirSync(docsExport, { recursive: true });

const outPath = join(outDir, name);
const result = spawnSync(
  "tar",
  [
    "-czf",
    outPath,
    "--exclude=node_modules",
    "--exclude=dist",
    "--exclude=.suite-logs",
    "--exclude=*.tsbuildinfo",
    "--exclude=.git",
    "-C",
    WORKSPACE,
    "enterprise-suite",
  ],
  { encoding: "utf8" },
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status ?? 1);
}

const copyPath = join(docsExport, name);
spawnSync("cp", [outPath, copyPath]);

const links = {
  generatedAt: new Date().toISOString(),
  archive: outPath,
  archiveCopy: copyPath,
  githubPr: "https://github.com/NicGodfrey/snow-brothers-3d/pull/1",
  branch: "cursor/enterprise-erp-srm-prm-f08d",
  localShell: "http://127.0.0.1:4000/",
  localPortal: "http://127.0.0.1:4300/",
  localAdmin: "http://127.0.0.1:4119/",
  localGateway: "http://127.0.0.1:4100/",
  localProgress: "http://127.0.0.1:8765/progress.html",
  startCommand: "cd enterprise-suite && npm install && npm run suite:start",
};

writeFileSync(join(outDir, "enterprise-suite-export.json"), JSON.stringify(links, null, 2));
writeFileSync(join(ROOT, "docs/export-links.json"), JSON.stringify(links, null, 2));
console.log(JSON.stringify(links, null, 2));
