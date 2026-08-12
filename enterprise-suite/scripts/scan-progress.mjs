#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "docs", "progress.json");
const EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".sql", ".md", ".json"]);
const SKIP = new Set(["node_modules", "dist", ".git", "coverage"]);

const MODULES = [
  { id: "sales-erp", path: "services/sales-erp", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Sales ERP" },
  { id: "marketing-erp", path: "services/marketing-erp", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Marketing ERP" },
  { id: "product-plm", path: "services/product-plm", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Product PLM" },
  { id: "supply-chain", path: "services/supply-chain", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Supply Chain" },
  { id: "inventory-wms", path: "services/inventory-wms", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Inventory WMS" },
  { id: "finance-erp", path: "services/finance-erp", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Finance ERP" },
  { id: "manufacturing-mes", path: "services/manufacturing-mes", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Manufacturing MES" },
  { id: "hcm-erp", path: "services/hcm-erp", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "HCM / HR" },
  { id: "quality-qms", path: "services/quality-qms", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Quality QMS" },
  { id: "logistics-tms", path: "services/logistics-tms", batch: "fable5", model: "claude-fable-5-thinking-xhigh", system: "ERP", label: "Logistics TMS" },
  { id: "srm-core", path: "services/srm-core", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "SRM", label: "SRM Core" },
  { id: "procurement-srm", path: "services/procurement-srm", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "SRM", label: "Procurement SRM" },
  { id: "prm-core", path: "services/prm-core", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "PRM", label: "PRM Core" },
  { id: "channel-prm", path: "services/channel-prm", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "PRM", label: "Channel PRM" },
  { id: "master-data", path: "services/master-data", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "ERP", label: "Master Data" },
  { id: "identity-access", path: "services/identity-access", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "Platform", label: "Identity Access" },
  { id: "integration-hub", path: "services/integration-hub", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "Platform", label: "Integration Hub" },
  { id: "reporting-bi", path: "services/reporting-bi", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "Platform", label: "Reporting BI" },
  { id: "web-portal", path: "apps/web-portal", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "Apps", label: "Web Portal" },
  { id: "admin-console", path: "apps/admin-console", batch: "opus5-fast", model: "claude-opus-5-thinking-high-fast", system: "Apps", label: "Admin Console" },
];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (EXTS.has(extname(name))) acc.push(p);
  }
  return acc;
}

function countLoc(dir) {
  const files = walk(dir);
  let lines = 0;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    lines += text.length ? text.split(/\r?\n/).length : 0;
  }
  return { files: files.length, lines };
}

function hasTsTree(dir) {
  return existsSync(dir) && walk(dir).some((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

function analyze(mod) {
  const p = join(ROOT, mod.path);
  const { files, lines } = countLoc(p);
  const checks = {
    "package.json": existsSync(join(p, "package.json")),
    domain: hasTsTree(join(p, "src/domain")),
    application: hasTsTree(join(p, "src/application")),
    infrastructure: hasTsTree(join(p, "src/infrastructure")),
    http: hasTsTree(join(p, "src/http")),
    migrations: existsSync(join(p, "migrations")) && walk(join(p, "migrations")).length > 0,
    tests: walk(p).some((f) => f.includes(".test.") || relative(p, f).startsWith("tests/")),
    readme: existsSync(join(p, "README.md")),
    index: existsSync(join(p, "src/index.ts")),
  };
  const score = Object.values(checks).filter(Boolean).length;
  const maxScore = Object.keys(checks).length;
  const percent = Math.round((100 * score) / maxScore);
  let status = "queued";
  if (score >= maxScore) status = "complete";
  else if (score >= 4) status = "building";
  else if (score > 0) status = "started";
  return { ...mod, files, lines, checks, score, maxScore, percent, status };
}

const modules = MODULES.map(analyze);
const sk = countLoc(join(ROOT, "packages/shared-kernel"));
const payload = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  totals: {
    modules: modules.length,
    complete: modules.filter((m) => m.status === "complete").length,
    building: modules.filter((m) => m.status === "building").length,
    started: modules.filter((m) => m.status === "started").length,
    queued: modules.filter((m) => m.status === "queued").length,
    files: modules.reduce((a, m) => a + m.files, 0) + sk.files,
    lines: modules.reduce((a, m) => a + m.lines, 0) + sk.lines,
    avgModulePercent: Math.round(modules.reduce((a, m) => a + m.percent, 0) / modules.length),
    fable5: {
      total: 10,
      active_or_done: modules.filter((m) => m.batch === "fable5" && m.status !== "queued").length,
      complete: modules.filter((m) => m.batch === "fable5" && m.status === "complete").length,
    },
    opus5fast: {
      total: 10,
      active_or_done: modules.filter((m) => m.batch === "opus5-fast" && m.status !== "queued").length,
      complete: modules.filter((m) => m.batch === "opus5-fast" && m.status === "complete").length,
    },
  },
  sharedKernel: sk,
  modules,
};

writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`Wrote ${OUT}`);
console.log(JSON.stringify(payload.totals, null, 2));
