import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("system consoles block stays display-only (no math/sort recomputation)", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");

  const start = src.indexOf("// SYSTEM_CONSOLES_START");
  const end = src.indexOf("// SYSTEM_CONSOLES_END");

  assert.notEqual(start, -1, "missing SYSTEM_CONSOLES_START marker");
  assert.notEqual(end, -1, "missing SYSTEM_CONSOLES_END marker");
  assert.ok(end > start, "system consoles markers out of order");

  const block = src.slice(start, end);
  const forbiddenPatterns = ["Math.", ".sort(", "closest/width", "upper - lower"];

  for (const pattern of forbiddenPatterns) {
    assert.equal(block.includes(pattern), false, `system consoles must not contain recompute pattern: ${pattern}`);
  }
});
