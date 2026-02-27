import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("orca operator panel block stays display-only (no risk-math recomputation)", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const html = fs.readFileSync(filePath, "utf8");

  const start = html.indexOf("// OPERATOR_ACTION_PANEL_START");
  const end = html.indexOf("// OPERATOR_ACTION_PANEL_END");

  assert.notEqual(start, -1, "missing OPERATOR_ACTION_PANEL_START marker");
  assert.notEqual(end, -1, "missing OPERATOR_ACTION_PANEL_END marker");
  assert.ok(end > start, "operator panel markers out of order");

  const block = html.slice(start, end);
  const forbiddenPatterns = [
    ".sort(",
    "localeCompare",
    "closest/width",
    "upper - lower",
    "mark - lower",
    "Math.min(",
    "Math.max(",
    "Math.abs(",
    "lowerBound",
    "upperBound",
    "clamp"
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(block.includes(pattern), false, `operator panel must not contain recompute pattern: ${pattern}`);
  }
});
