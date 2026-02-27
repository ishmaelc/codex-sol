import test from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioIndexSystemEntry } from "../../portfolio/engine.js";
import type { HedgedSystemSnapshot } from "../../portfolio/types.js";

function mkSnapshot(overrides: Partial<HedgedSystemSnapshot> = {}): HedgedSystemSnapshot {
  return {
    id: "sol_hedged",
    label: "SOL Hedged Yield System",
    netDelta: 2,
    totalLong: 100,
    totalShort: 98,
    leverage: 2.3,
    liqBufferPct: 0.22,
    score: 0.66,
    breakdown: {
      delta: 0.7,
      hedge: 0.65,
      range: 0.6,
      stability: 0.5,
      weighted: 0.66,
      status: "yellow"
    },
    riskFlags: ["LOW_LIQ_BUFFER"],
    canonicalSnapshot: {
      systemId: "SOL_HEDGED_YIELD",
      asOfTs: "2026-02-27T00:00:00.000Z",
      pricesUsed: { mark: 145, baseAsset: "SOL" },
      dataFreshness: { hasMarkPrice: true, hasLiqPrice: true, hasRangeBuffer: true },
      exposures: { totalLong: 100, totalShort: 98, netDelta: 2, hedgeRatio: 0.98 },
      liquidation: { liqPrice: 175, liqBufferRatio: 0.2, leverage: 2.3 },
      range: { rangeLower: 120, rangeUpper: 170, rangeBufferRatio: 0.08 },
      basisRisk: { isProxyHedge: false, basisPenalty: 0, reasonTag: null },
      debugMath: { liqBufferRatio: 0.2, rangeBufferRatio: 0.08 },
      reasons: ["LOW_LIQ_BUFFER"]
    },
    updatedAt: "2026-02-27T00:00:00.000Z",
    ...overrides
  };
}

function assertRatio(value: number | null): void {
  if (value == null) return;
  assert.ok(value >= 0 && value <= 1);
}

test("portfolio systems index entry preserves legacy fields and adds canonical scoreObj+snapshot", () => {
  const exported = buildPortfolioIndexSystemEntry(mkSnapshot());

  assert.equal(typeof exported.score, "number");
  assert.equal(exported.status, "yellow");

  assert.ok(exported.scoreObj);
  assert.equal(exported.scoreObj.score0to100, Math.round(exported.scoreObj.score0to1 * 100));
  assert.ok(["GREEN", "YELLOW", "RED"].includes(exported.scoreObj.label));
  assert.ok(typeof exported.scoreObj.components.hedge === "number");
  assert.ok(typeof exported.scoreObj.components.liquidation === "number");
  assert.ok(typeof exported.scoreObj.components.range === "number");
  assert.ok(typeof exported.scoreObj.components.dataQuality === "number");
  assert.ok(typeof exported.scoreObj.components.basisRisk === "number");

  assert.ok(exported.snapshot);
  if (!exported.snapshot) throw new Error("missing snapshot");
  assert.ok(typeof exported.snapshot.exposures.netDelta === "number");
  assertRatio(exported.snapshot.exposures.hedgeRatio);
  assertRatio(exported.snapshot.liquidation.liqBufferRatio);
  assertRatio(exported.snapshot.range.rangeBufferRatio);
});

test("nx8 entry includes proxy hedge basis risk in canonical snapshot", () => {
  const exported = buildPortfolioIndexSystemEntry(
    mkSnapshot({
      id: "nx8_hedged",
      label: "NX8 Hedged Yield System",
      canonicalSnapshot: {
        systemId: "NX8_HEDGED_YIELD",
        asOfTs: "2026-02-27T00:00:00.000Z",
        pricesUsed: { mark: 99000, baseAsset: "NX8" },
        dataFreshness: { hasMarkPrice: true, hasLiqPrice: true, hasRangeBuffer: true },
        exposures: { totalLong: 5000, totalShort: 0.09, netDelta: 2000, hedgeRatio: 0.86 },
        liquidation: { liqPrice: 115000, liqBufferRatio: 0.16, leverage: 2.4 },
        range: { rangeLower: null, rangeUpper: null, rangeBufferRatio: 0 },
        basisRisk: { isProxyHedge: true, basisPenalty: 0, reasonTag: "PROXY_HEDGE" },
        debugMath: { liqBufferRatio: 0.16, rangeBufferRatio: 0 },
        reasons: ["PROXY_HEDGE"]
      }
    })
  );

  assert.equal(exported.snapshot?.basisRisk.isProxyHedge, true);
  assert.ok(exported.snapshot?.reasons.includes("PROXY_HEDGE"));
  assert.ok((exported.scoreObj.components.basisRisk ?? 1) < 1);
});

test("liquidation nulls force freshness false and remove sentinel-like fields", () => {
  const exported = buildPortfolioIndexSystemEntry(
    mkSnapshot({
      canonicalSnapshot: {
        ...mkSnapshot().canonicalSnapshot!,
        dataFreshness: { hasMarkPrice: true, hasLiqPrice: true, hasRangeBuffer: true },
        liquidation: { liqPrice: null, liqBufferRatio: -1, leverage: 0 }
      }
    })
  );

  if (!exported.snapshot) throw new Error("missing snapshot");
  assert.equal(exported.snapshot.dataFreshness.hasLiqPrice, false);
  assert.equal(exported.snapshot.liquidation.liqPrice, null);
  assert.equal(exported.snapshot.liquidation.liqBufferRatio, null);
  assert.equal(exported.snapshot.liquidation.leverage, null);
});

test("ratios are clamped to [0,1] when present", () => {
  const exported = buildPortfolioIndexSystemEntry(
    mkSnapshot({
      canonicalSnapshot: {
        ...mkSnapshot().canonicalSnapshot!,
        exposures: { totalLong: 100, totalShort: 98, netDelta: 2, hedgeRatio: 1.3 },
        liquidation: { liqPrice: 175, liqBufferRatio: -0.1, leverage: 2.3 },
        range: { rangeLower: 120, rangeUpper: 170, rangeBufferRatio: 1.4 },
        debugMath: { liqBufferRatio: -0.1, rangeBufferRatio: 1.4 }
      }
    })
  );

  if (!exported.snapshot) throw new Error("missing snapshot");
  assert.equal(exported.snapshot.exposures.hedgeRatio, 1);
  assert.equal(exported.snapshot.liquidation.liqBufferRatio, 0);
  assert.equal(exported.snapshot.range.rangeBufferRatio, 1);
});

test("canonical snapshot never exports liqPrice as zero", () => {
  const exported = buildPortfolioIndexSystemEntry(
    mkSnapshot({
      canonicalSnapshot: {
        ...mkSnapshot().canonicalSnapshot!,
        dataFreshness: { hasMarkPrice: true, hasLiqPrice: true, hasRangeBuffer: true },
        liquidation: { liqPrice: 0, liqBufferRatio: 0, leverage: 0 }
      }
    })
  );

  if (!exported.snapshot) throw new Error("missing snapshot");
  assert.equal(exported.snapshot.liquidation.liqPrice, null);
  assert.equal(exported.snapshot.liquidation.liqBufferRatio, null);
  assert.equal(exported.snapshot.liquidation.leverage, null);
  assert.equal(exported.snapshot.dataFreshness.hasLiqPrice, false);
  assert.equal(exported.scoreObj.components.liquidation, 0.5);
});

test("liquidation component is not forced to neutral when liq data is present", () => {
  const exported = buildPortfolioIndexSystemEntry(mkSnapshot());
  assert.equal(exported.snapshot?.dataFreshness.hasLiqPrice, true);
  assert.equal(exported.scoreObj.components.liquidation, 0.65);
  assert.notEqual(exported.scoreObj.components.liquidation, 0.5);
});
