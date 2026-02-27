import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function getAttentionStripBlock(): string {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");
  const start = src.indexOf("// ATTENTION_STRIP_START");
  const end = src.indexOf("// ATTENTION_STRIP_END");
  assert.notEqual(start, -1, "missing ATTENTION_STRIP_START marker");
  assert.notEqual(end, -1, "missing ATTENTION_STRIP_END marker");
  assert.ok(end > start, "ATTENTION_STRIP markers out of order");
  return src.slice(start, end);
}

test("attention strip is display-only (no risk math recomputation)", () => {
  const block = getAttentionStripBlock();
  const forbidden = ["Math.min", "Math.max", "/ width", "upper - lower", "clamp", "rangeBufferRatio ="];
  for (const pattern of forbidden) {
    assert.equal(block.includes(pattern), false, `attention strip must not contain risk math: "${pattern}"`);
  }
});

test("attention strip driver chips use systemShortLabel and systemAlertLevel helpers", () => {
  const block = getAttentionStripBlock();
  assert.ok(block.includes("systemShortLabel"), "must use systemShortLabel helper for clean labels");
  assert.ok(block.includes("systemAlertLevel"), "must use systemAlertLevel helper for level attribution");
});

test("attention strip driver source is alerts systems only (no positions data)", () => {
  const block = getAttentionStripBlock();
  assert.equal(block.includes("positionsSummary"), false, "driver attribution must not use positions data");
  assert.equal(block.includes("systems_index"), false, "driver attribution must not use systems_index");
  assert.ok(block.includes("getAlertsSystems"), "driver attribution must read from alerts systems");
});

test("systemShortLabel extracts clean short name from system label or id", () => {
  const filePath = path.resolve(process.cwd(), "public/app.js");
  const src = fs.readFileSync(filePath, "utf8");
  assert.ok(
    src.includes('raw.split(/[\\s_]/)[0].toUpperCase()'),
    "systemShortLabel must split on space or underscore to get first word"
  );
});

test("driver chips use chip-critical modifier for critical systems", () => {
  const block = getAttentionStripBlock();
  assert.ok(block.includes("chip-critical"), "critical driver systems must render with chip-critical class");
  assert.ok(block.includes("chip-warning"), "warning driver systems must render with chip-warning class");
});
