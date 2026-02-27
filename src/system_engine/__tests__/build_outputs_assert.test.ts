import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = path.resolve(process.cwd(), "scripts/assert_build_outputs.js");

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function touch(base: string, rel: string, content = "{}") {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

test("assert_build_outputs fails with sorted missing file list", () => {
  const base = mkTmpDir("assert-build-missing-");
  touch(base, "public/data/orca/regime_state.json");

  const res = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, ASSERT_BASEDIR: base },
    encoding: "utf8"
  });

  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /Missing required build artifacts/);
  assert.match(res.stderr, /public\/data\/orca\/alerts\.json/);
  assert.match(res.stderr, /public\/data\/portfolio\/systems_index\.json/);
});

test("assert_build_outputs succeeds when required files exist", () => {
  const base = mkTmpDir("assert-build-ok-");

  for (const rel of REQUIRED_FILES) touch(base, rel);

  const res = spawnSync(process.execPath, [SCRIPT_PATH], {
    env: { ...process.env, ASSERT_BASEDIR: base },
    encoding: "utf8"
  });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /OK: required build artifacts exist/);
});
const REQUIRED_FILES = [
  "public/data/orca/regime_state.json",
  "public/data/orca/pool_rankings.json",
  "public/data/orca/shortlist.json",
  "public/data/orca/plans.json",
  "public/data/orca/allocation.json",
  "public/data/orca/alerts.json",
  "public/data/orca/performance.json",
  "public/data/portfolio/systems_index.json",
  "public/data/portfolio/cadence_24/systems_index.json",
  "public/data/portfolio/cadence_48/systems_index.json"
];
