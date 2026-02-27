import test from "node:test";
import assert from "node:assert/strict";
import { computeSolSystem } from "../../sol_system.js";
import { computeSystemHealth } from "../health/compute_health.js";
import { buildSolSystemSnapshotFromSummary } from "../sol/build_snapshot.js";
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";
import {
  computeDeltaScore,
  computeHedgeSafetyScore,
  computeRangeHealthScore,
  computeStabilityScore,
  computeSystemScore
} from "../../portfolio/scoring.js";
import { scoreFromPortfolioScore } from "../score_adapter.js";

function mkSnapshot(args: {
  hedgeRatio: number;
  liqBufferRatio: number | null;
  rangeBufferRatio: number | null;
}) {
  return {
    exposures: { hedgeRatio: args.hedgeRatio },
    liquidation: { liqBufferRatio: args.liqBufferRatio },
    range: { rangeBufferRatio: args.rangeBufferRatio }
  };
}

test("health band boundary thresholds", () => {
  const strong = computeSystemHealth(mkSnapshot({ hedgeRatio: 0.95, liqBufferRatio: 0.3, rangeBufferRatio: 0.08 }));
  assert.equal(strong.hedge, "strong");
  assert.equal(strong.liquidation, "strong");
  assert.equal(strong.range, "strong");

  const acceptable = computeSystemHealth(mkSnapshot({ hedgeRatio: 0.85, liqBufferRatio: 0.15, rangeBufferRatio: 0.03 }));
  assert.equal(acceptable.hedge, "acceptable");
  assert.equal(acceptable.liquidation, "acceptable");
  assert.equal(acceptable.range, "acceptable");

  const degraded = computeSystemHealth(mkSnapshot({ hedgeRatio: 0.75, liqBufferRatio: 0.08, rangeBufferRatio: 0.01 }));
  assert.equal(degraded.hedge, "degraded");
  assert.equal(degraded.liquidation, "degraded");
  assert.equal(degraded.range, "degraded");

  const critical = computeSystemHealth(mkSnapshot({ hedgeRatio: 0.74, liqBufferRatio: 0.079, rangeBufferRatio: 0.009 }));
  assert.equal(critical.hedge, "critical");
  assert.equal(critical.liquidation, "critical");
  assert.equal(critical.range, "critical");
});

test("worst-dimension precedence drives overall band", () => {
  const health = computeSystemHealth(mkSnapshot({ hedgeRatio: 1, liqBufferRatio: 0.32, rangeBufferRatio: 0.005 }));
  assert.equal(health.hedge, "strong");
  assert.equal(health.liquidation, "strong");
  assert.equal(health.range, "critical");
  assert.equal(health.overall, "critical");
});

test("score object remains unchanged when health is added", () => {
  const input = buildSolSummaryInputFixture();
  const solSystem = computeSolSystem(input);

  const snapshot = buildSolSystemSnapshotFromSummary({
    ...input,
    rangeBufferRatio: input.rangeBufferPct
  });
  const portfolioScore = computeSystemScore({
    deltaScore: computeDeltaScore(snapshot.exposures.netSOLDelta, Math.max(snapshot.exposures.totalLongSOL * 0.3, 0.1)),
    hedgeScore: computeHedgeSafetyScore({
      leverage: Number.isFinite(Number(snapshot.liquidation.leverage)) ? Number(snapshot.liquidation.leverage) : 3,
      liqBufferPct: Number(snapshot.liquidation.liqBufferRatio ?? 0) * 100,
      fundingApr: 10
    }),
    rangeScore: computeRangeHealthScore({
      inRange: true,
      distanceToEdgePct: Number(snapshot.range.rangeBufferRatio ?? 0) * 100,
      widthPct: Number(snapshot.range.rangeBufferRatio ?? 0) * 200,
      regime: "MODERATE"
    }),
    stabilityScore: computeStabilityScore({
      volumeTvl: 0,
      depth1pctUsd: 0,
      feeApr: 0,
      regimeConfidence: 0.4
    })
  });
  const expectedScore = scoreFromPortfolioScore({
    portfolioScore,
    reasons: solSystem.snapshot.reasons,
    basisRisk: snapshot.basisRisk,
    dataFreshness: snapshot.dataFreshness
  });

  assert.deepEqual(solSystem.score, expectedScore);
});

test("health calculation is deterministic and idempotent", () => {
  const snapshot = mkSnapshot({ hedgeRatio: 0.9, liqBufferRatio: null, rangeBufferRatio: 0.05 });
  const first = computeSystemHealth(snapshot);
  const second = computeSystemHealth(snapshot);
  assert.deepEqual(first, second);
});
