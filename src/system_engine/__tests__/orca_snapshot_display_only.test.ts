import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("orca snapshot block stays display-only (no recompute/sort)", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");

  const start = src.indexOf("// ORCA_SNAPSHOT_START");
  const end = src.indexOf("// ORCA_SNAPSHOT_END");

  assert.notEqual(start, -1, "missing ORCA_SNAPSHOT_START marker");
  assert.notEqual(end, -1, "missing ORCA_SNAPSHOT_END marker");
  assert.ok(end > start, "orca snapshot markers out of order");

  const block = src.slice(start, end);
  const forbiddenPatterns = ["Math.", ".sort(", "closest/width"];
  for (const pattern of forbiddenPatterns) {
    assert.equal(block.includes(pattern), false, `orca snapshot must not contain: ${pattern}`);
  }
});
