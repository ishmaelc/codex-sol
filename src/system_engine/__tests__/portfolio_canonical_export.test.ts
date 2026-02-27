import test from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioIndexSystemEntry } from "../../portfolio/engine.js";
import type { HedgedSystemSnapshot } from "../../portfolio/types.js";
import { computeSolSystem } from "../../sol_system.js";
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";

function baseSnapshot(overrides: Partial<HedgedSystemSnapshot> = {}): HedgedSystemSnapshot {
  return {
    id: "sol_hedged",
    label: "SOL Hedged Yield System",
    netDelta: 0,
    totalLong: 100,
    totalShort: 95,
    leverage: 2.2,
    liqBufferPct: 0.24,
    score: 0.72,
    breakdown: {
      delta: 0.8,
      hedge: 0.7,
      range: 0.6,
      stability: 0.9,
      weighted: 0.72,
      status: "yellow"
    },
    riskFlags: ["LOW_LIQ_BUFFER"],
    updatedAt: "2026-02-27T00:00:00.000Z",
    ...overrides
  };
}

function assertRatioOrNull(value: number | null): void {
  if (value == null) return;
  assert.ok(value >= 0 && value <= 1);
}

test("portfolio index export contains canonical score and snapshot shape", () => {
  const sol = computeSolSystem(buildSolSummaryInputFixture());
  const mocked = baseSnapshot({
    canonicalScore: sol.score,
    canonicalSnapshot: {
      systemId: "SOL_HEDGED_YIELD",
      asOfTs: sol.snapshot.asOfTs,
      pricesUsed: { mark: sol.snapshot.pricesUsed.sol, baseAsset: "SOL" },
      dataFreshness: sol.snapshot.dataFreshness,
      exposures: {
        totalLong: sol.snapshot.exposures.totalLongSOL,
        totalShort: sol.snapshot.exposures.totalShortSOL,
        netDelta: sol.snapshot.exposures.netSOLDelta,
        hedgeRatio: sol.snapshot.exposures.hedgeRatio
      },
      liquidation: sol.snapshot.liquidation,
      range: sol.snapshot.range,
      basisRisk: sol.snapshot.basisRisk,
      debugMath: sol.snapshot.debugMath,
      reasons: sol.snapshot.reasons
    }
  });

  const exported = buildPortfolioIndexSystemEntry(mocked);

  assert.equal(exported.score, mocked.score);
  assert.equal(exported.status, mocked.breakdown.status);
  assert.equal(exported.scoreObj.score0to100, Math.round(exported.scoreObj.score0to1 * 100));
  assert.ok(["GREEN", "YELLOW", "RED"].includes(exported.scoreObj.label));
  assert.ok(exported.snapshot != null);
  if (!exported.snapshot) throw new Error("snapshot missing");
  assertRatioOrNull(exported.snapshot.exposures.hedgeRatio);
  assertRatioOrNull(exported.snapshot.liquidation.liqBufferRatio);
  assertRatioOrNull(exported.snapshot.range.rangeBufferRatio);
  assert.ok(Number.isFinite(exported.snapshot.exposures.netDelta));
});

test("portfolio canonical SOL score matches computeSolSystem canonical score when sourced from same payload", () => {
  const input = buildSolSummaryInputFixture();
  const sol = computeSolSystem(input);
  const mocked = baseSnapshot({
    canonicalScore: sol.score,
    canonicalSnapshot: {
      systemId: "SOL_HEDGED_YIELD",
      asOfTs: sol.snapshot.asOfTs,
      pricesUsed: { mark: sol.snapshot.pricesUsed.sol, baseAsset: "SOL" },
      dataFreshness: sol.snapshot.dataFreshness,
      exposures: {
        totalLong: sol.snapshot.exposures.totalLongSOL,
        totalShort: sol.snapshot.exposures.totalShortSOL,
        netDelta: sol.snapshot.exposures.netSOLDelta,
        hedgeRatio: sol.snapshot.exposures.hedgeRatio
      },
      liquidation: sol.snapshot.liquidation,
      range: sol.snapshot.range,
      basisRisk: sol.snapshot.basisRisk,
      debugMath: sol.snapshot.debugMath,
      reasons: sol.snapshot.reasons
    }
  });

  const exported = buildPortfolioIndexSystemEntry(mocked);
  assert.deepEqual(exported.scoreObj, sol.score);
});

test("nx8 export keeps canonical snapshot with basis risk fields", () => {
  const mockedNx8 = baseSnapshot({
    id: "nx8_hedged",
    label: "NX8 Hedged Yield System",
    canonicalSnapshot: {
      systemId: "NX8_HEDGED_YIELD",
      asOfTs: "2026-02-27T00:00:00.000Z",
      pricesUsed: { mark: 98000, baseAsset: "NX8" },
      dataFreshness: { hasMarkPrice: true, hasLiqPrice: true, hasRangeBuffer: true },
      exposures: { totalLong: 5000, totalShort: 0.08, netDelta: 1500, hedgeRatio: 0.82 },
      liquidation: { liqPrice: 115000, liqBufferRatio: 0.17, leverage: 2.5 },
      range: { rangeLower: null, rangeUpper: null, rangeBufferRatio: 0 },
      basisRisk: { isProxyHedge: true, basisPenalty: 0, reasonTag: "PROXY_HEDGE" },
      debugMath: { liqBufferRatio: 0.17, rangeBufferRatio: 0 },
      reasons: ["PROXY_HEDGE"]
    }
  });

  const exportedNx8 = buildPortfolioIndexSystemEntry(mockedNx8);
  assert.equal(exportedNx8.snapshot?.basisRisk.isProxyHedge, true);
  assert.ok(exportedNx8.snapshot?.reasons.includes("PROXY_HEDGE"));
});
