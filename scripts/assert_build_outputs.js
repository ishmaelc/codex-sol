#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_FILES = [
  // Orca dashboard static data fetched by public/orca.html
  "public/data/orca/regime_state.json",
  "public/data/orca/pool_rankings.json",
  "public/data/orca/shortlist.json",
  "public/data/orca/plans.json",
  "public/data/orca/allocation.json",
  "public/data/orca/alerts.json",
  "public/data/orca/performance.json",
  // Main dashboard + systems views
  "public/data/portfolio/systems_index.json",
  "public/data/portfolio/cadence_24/systems_index.json",
  "public/data/portfolio/cadence_48/systems_index.json"
];

export function findMissingFiles(baseDir = process.cwd(), requiredFiles = REQUIRED_FILES) {
  const root = path.resolve(baseDir);
  const missing = [];
  for (const relPath of requiredFiles) {
    const absPath = path.resolve(root, relPath);
    if (!fs.existsSync(absPath)) missing.push(relPath);
  }
  return missing.sort((a, b) => a.localeCompare(b));
}

function run() {
  const baseDir = process.env.ASSERT_BASEDIR ? path.resolve(process.env.ASSERT_BASEDIR) : process.cwd();
  const missing = findMissingFiles(baseDir, REQUIRED_FILES);

  if (missing.length === 0) {
    console.log("[assert_build_outputs] OK: required build artifacts exist.");
    return;
  }

  console.error("[assert_build_outputs] Missing required build artifacts:");
  for (const rel of missing) {
    console.error(` - ${rel}`);
  }
  console.error("[assert_build_outputs] Hint: generate artifacts with `npm run orca:refresh`.");
  process.exitCode = 1;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
})();

if (isDirectRun) run();
