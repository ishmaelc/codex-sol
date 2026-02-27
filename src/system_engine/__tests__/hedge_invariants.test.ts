import test from "node:test";
import assert from "node:assert/strict";
import { computeSolSystem } from "../../sol_system.js";
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";

test("netDelta integrity", () => {
  const result = computeSolSystem(buildSolSummaryInputFixture());
  const { totalLongSOL, totalShortSOL, netSOLDelta } = result.snapshot.exposures;

  if (totalLongSOL > 0 || totalShortSOL > 0) {
    assert.ok(Math.abs(netSOLDelta - (totalLongSOL - totalShortSOL)) <= 1e-10);
  }
});

test("hedgeRatio integrity", () => {
  const result = computeSolSystem(buildSolSummaryInputFixture());
  const { totalLongSOL, totalShortSOL, hedgeRatio } = result.snapshot.exposures;

  if (totalLongSOL > 0) {
    assert.ok(Math.abs(hedgeRatio - totalShortSOL / totalLongSOL) <= 1e-10);
  } else {
    assert.equal(hedgeRatio, 0);
  }
});

test("ratio clamp integrity", () => {
  const result = computeSolSystem(buildSolSummaryInputFixture());
  const liq = result.snapshot.liquidation.liqBufferRatio;
  const range = result.snapshot.range.rangeBufferRatio;

  assert.notEqual(liq, null);
  assert.notEqual(range, null);
  if (liq == null || range == null) throw new Error("expected non-null ratios for fixture");

  assert.ok(liq >= 0);
  assert.ok(liq <= 1);
  assert.ok(range >= 0);
  assert.ok(range <= 1);
});
