#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".sql", ".md", ".json", ".yml", ".yaml"]);
const SKIP = new Set(["node_modules", "dist", ".git", "coverage"]);

let files = 0;
let lines = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (EXTS.has(extname(name))) {
      files += 1;
      lines += readFileSync(p, "utf8").split(/\r?\n/).length;
    }
  }
}

walk(ROOT);
console.log(JSON.stringify({ root: ROOT, files, lines }, null, 2));
