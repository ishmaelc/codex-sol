import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDeltaScore,
  computeHedgeSafetyScore,
  computeRangeHealthScore,
  computeStabilityScore,
  computeSystemScore
} from "../../portfolio/scoring.js";
import { computeSolSystem } from "../../sol_system.js";
import { scoreFromPortfolioScore } from "../score_adapter.js";
import { buildSolSystemSnapshotFromSummary } from "../sol/build_snapshot.js";

test("SOL score is consistent across console and portfolio scoring pipeline", () => {
  const input = {
    solLong: 120.25,
    solShort: 114.9,
    markPrice: 146.5,
    liqPrice: 205.1,
    rangeBufferPct: 0.082,
    rangeLower: 125.25,
    rangeUpper: 162.1,
    leverage: 2.4,
    reasons: ["LOW_LIQ_BUFFER"]
  };

  const solSystem = computeSolSystem(input);

  const snapshot = buildSolSystemSnapshotFromSummary(input);
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
  const adaptedScore = scoreFromPortfolioScore({
    portfolioScore,
    reasons: snapshot.reasons,
    basisRisk: snapshot.basisRisk,
    dataFreshness: snapshot.dataFreshness
  });

  assert.deepEqual(solSystem.score, adaptedScore);
  assert.equal(solSystem.score.score0to100, Math.round(solSystem.score.score0to1 * 100));
  assert.equal(solSystem.score.components.dataQuality, 1);
  assert.ok(solSystem.snapshot.exposures.hedgeRatio >= 0 && solSystem.snapshot.exposures.hedgeRatio <= 1);
  assert.ok(solSystem.snapshot.liquidation.liqBufferRatio == null || (solSystem.snapshot.liquidation.liqBufferRatio >= 0 && solSystem.snapshot.liquidation.liqBufferRatio <= 1));
  assert.ok(solSystem.snapshot.range.rangeBufferRatio == null || (solSystem.snapshot.range.rangeBufferRatio >= 0 && solSystem.snapshot.range.rangeBufferRatio <= 1));
  assert.equal(solSystem.snapshot.range.rangeLower, input.rangeLower);
  assert.equal(solSystem.snapshot.range.rangeUpper, input.rangeUpper);
});

test("UNDERHEDGED reason tag is added when action is Increase SOL short", () => {
  const solSystem = computeSolSystem({
    solLong: 100,
    solShort: 70,
    markPrice: 150,
    liqPrice: 180,
    rangeBufferPct: 0.2
  });

  assert.equal(solSystem.action, "Increase SOL short");
  assert.ok(solSystem.snapshot.reasons.includes("UNDERHEDGED"));
  assert.ok(solSystem.score.reasons.includes("UNDERHEDGED"));
});
