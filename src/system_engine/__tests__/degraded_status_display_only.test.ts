import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("degraded status block stays display-only (no math/sort recomputation)", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");

  const start = src.indexOf("// DEGRADED_STATUS_START");
  const end = src.indexOf("// DEGRADED_STATUS_END");

  assert.notEqual(start, -1, "missing DEGRADED_STATUS_START marker");
  assert.notEqual(end, -1, "missing DEGRADED_STATUS_END marker");
  assert.ok(end > start, "degraded status markers out of order");

  const block = src.slice(start, end);
  const forbiddenPatterns = ["Math.", ".sort("];
  for (const pattern of forbiddenPatterns) {
    assert.equal(block.includes(pattern), false, `degraded status block must not contain: ${pattern}`);
  }

  assert.equal(block.includes("meta?.degraded"), true, "degraded status must be driven by summary.meta.degraded");
  assert.equal(block.includes("DEGRADED (cached)"), true, "degraded status must render DEGRADED (cached) text");
  assert.equal(block.includes("fallback:"), true, "degraded details must include fallback source text");
});

test("main UI contains no Hedge Drift section text", () => {
  const indexPath = path.resolve(process.cwd(), "public/index.html");
  const appPath = path.resolve(process.cwd(), "public/app.js");
  const indexSrc = fs.readFileSync(indexPath, "utf8");
  const appSrc = fs.readFileSync(appPath, "utf8");

  assert.equal(indexSrc.includes("Hedge Drift"), false, "index.html should not render Hedge Drift text");
  assert.equal(appSrc.includes("Hedge Drift"), false, "app.js should not render Hedge Drift text");
});
