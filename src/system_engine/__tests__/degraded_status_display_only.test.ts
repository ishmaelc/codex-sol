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
});
