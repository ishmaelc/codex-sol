import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("system consoles block stays display-only (no math/sort recomputation)", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");

  const start = src.indexOf("// SYSTEM_CONSOLES_TABLE_START");
  const end = src.indexOf("// SYSTEM_CONSOLES_TABLE_END");

  assert.notEqual(start, -1, "missing SYSTEM_CONSOLES_TABLE_START marker");
  assert.notEqual(end, -1, "missing SYSTEM_CONSOLES_TABLE_END marker");
  assert.ok(end > start, "system consoles markers out of order");

  const block = src.slice(start, end);
  const forbiddenPatterns = ["Math.", ".sort(", "closest/width", "upper - lower"];

  for (const pattern of forbiddenPatterns) {
    assert.equal(block.includes(pattern), false, `system consoles must not contain recompute pattern: ${pattern}`);
  }
});

test("system consoles action row is trigger-driven, not forced by MISSING_DATA reason", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");
  const start = src.indexOf("// SYSTEM_CONSOLES_TABLE_START");
  const end = src.indexOf("// SYSTEM_CONSOLES_TABLE_END");
  const block = src.slice(start, end);

  assert.equal(
      block.includes('const actionText = generateRebalanceActionMessage(system, label);'),
    true,
      "action must derive from system snapshot + capitalGuard triggers"
  );
  assert.equal(
    block.includes('hasMissingData ? "MISSING_DATA"'),
    false,
    "MISSING_DATA reason must not override action row"
  );
});

test("system consoles are sourced from alerts systems only", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");
  const start = src.indexOf("// SYSTEM_CONSOLES_TABLE_START");
  const end = src.indexOf("// SYSTEM_CONSOLES_TABLE_END");
  const block = src.slice(start, end);

  assert.equal(block.includes("resolveSystemKinds"), true, "systems overview should resolve systems from alerts payload");
  assert.equal(block.includes("findAlertSystem"), false, "systems overview should not rely on strict hardcoded id lookup");
  assert.equal(block.includes("latestPortfolioSystems"), false, "systems overview must not read systems_index in UI table");
  assert.equal(block.includes("positionsSummary"), false, "systems overview must not depend on positions summary");
});
