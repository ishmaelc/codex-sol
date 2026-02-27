import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSnapshot } from "../../system_engine/invariants.js";
import { computeSystemHealth } from "../../system_engine/health/compute_health.js";
import type { CanonicalSystemSnapshot } from "../../portfolio/types.js";

function makeSnapshot(overrides: Partial<CanonicalSystemSnapshot["range"]> & {
  dataFreshness?: Partial<CanonicalSystemSnapshot["dataFreshness"]>
} = {}): CanonicalSystemSnapshot {
  const { dataFreshness: freshnessOverrides, ...rangeOverrides } = overrides;
  return {
    systemId: "TEST",
    asOfTs: new Date().toISOString(),
    pricesUsed: { mark: 100 },
    dataFreshness: {
      hasMarkPrice: true,
      hasLiqPrice: true,
      hasRangeBuffer: true,
      ...freshnessOverrides
    },
    exposures: { totalLong: 10, totalShort: 10, netDelta: 0, hedgeRatio: 1 },
    liquidation: { liqPrice: 50, liqBufferRatio: 0.5, leverage: 2 },
    range: {
      rangeLower: 80,
      rangeUpper: 120,
      rangeBufferRatio: 0.2,
      ...rangeOverrides
    },
    basisRisk: { isProxyHedge: false, basisPenalty: 0, reasonTag: null },
    debugMath: { liqBufferRatio: 0.5, rangeBufferRatio: 0.2 },
    reasons: []
  };
}

test("null rangeLower forces rangeBufferRatio=null and hasRangeBuffer=false", () => {
  const snapshot = makeSnapshot({ rangeLower: null, rangeUpper: 120, rangeBufferRatio: 0.2 });
  const normalized = normalizeSnapshot(snapshot);

  assert.equal(normalized.range.rangeBufferRatio, null, "rangeBufferRatio must be null when lower bound is null");
  assert.equal(normalized.dataFreshness.hasRangeBuffer, false, "hasRangeBuffer must be false when lower bound is null");
});

test("null rangeUpper forces rangeBufferRatio=null and hasRangeBuffer=false", () => {
  const snapshot = makeSnapshot({ rangeLower: 80, rangeUpper: null, rangeBufferRatio: 0.2 });
  const normalized = normalizeSnapshot(snapshot);

  assert.equal(normalized.range.rangeBufferRatio, null, "rangeBufferRatio must be null when upper bound is null");
  assert.equal(normalized.dataFreshness.hasRangeBuffer, false, "hasRangeBuffer must be false when upper bound is null");
});

test("null bounds with rangeBufferRatio=0 (NX8 bug pattern) forces null, not zero", () => {
  const snapshot = makeSnapshot({
    rangeLower: null,
    rangeUpper: null,
    rangeBufferRatio: 0,
    dataFreshness: { hasMarkPrice: true, hasLiqPrice: true, hasRangeBuffer: true }
  });
  const normalized = normalizeSnapshot(snapshot);

  assert.equal(normalized.range.rangeBufferRatio, null, "rangeBufferRatio=0 with null bounds must become null");
  assert.equal(normalized.dataFreshness.hasRangeBuffer, false, "hasRangeBuffer must be false when bounds are null");
});

test("null bounds do not trigger range_exit_risk (health is neutral, not critical)", () => {
  const snapshot = makeSnapshot({ rangeLower: null, rangeUpper: null, rangeBufferRatio: 0 });
  const normalized = normalizeSnapshot(snapshot);
  const health = computeSystemHealth(normalized);

  assert.notEqual(health.range, "critical", "null bounds must not produce critical range health");
  assert.ok(
    health.range === "acceptable" || health.range === "strong",
    `null bounds must produce neutral range health, got: ${health.range}`
  );
});

test("valid bounds with valid rangeBufferRatio pass through unchanged", () => {
  const snapshot = makeSnapshot({ rangeLower: 80, rangeUpper: 120, rangeBufferRatio: 0.15 });
  const normalized = normalizeSnapshot(snapshot);

  assert.equal(normalized.range.rangeBufferRatio, 0.15);
  assert.equal(normalized.dataFreshness.hasRangeBuffer, true);
});

test("valid bounds with rangeBufferRatio=0 stays zero (at-edge is valid, not missing)", () => {
  const snapshot = makeSnapshot({ rangeLower: 80, rangeUpper: 120, rangeBufferRatio: 0 });
  const normalized = normalizeSnapshot(snapshot);

  assert.equal(normalized.range.rangeBufferRatio, 0, "zero ratio with valid bounds must stay zero");
  assert.equal(normalized.dataFreshness.hasRangeBuffer, true, "bounds present + ratio=0 means at-edge, hasRangeBuffer=true");
});
