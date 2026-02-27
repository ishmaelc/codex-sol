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
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";

const SCORE_LABELS = new Set(["GREEN", "YELLOW", "RED"]);

function assertRatio01(value: number, label: string): void {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
  assert.ok(value >= 0 && value <= 1, `${label} must be in [0,1]`);
}

test("Score scale invariant", () => {
  const input = buildSolSummaryInputFixture();
  const result = computeSolSystem(input);

  assert.equal(typeof result.score.score0to1, "number");
  assert.ok(result.score.score0to1 >= 0 && result.score.score0to1 <= 1);
  assert.equal(result.score.score0to100, Math.round(result.score.score0to1 * 100));
  assert.ok(SCORE_LABELS.has(result.score.label));

  const componentKeys = Object.keys(result.score.components).sort();
  assert.deepEqual(componentKeys, ["basisRisk", "dataQuality", "hedge", "liquidation", "range"]);
  assertRatio01(result.score.components.hedge, "components.hedge");
  assertRatio01(result.score.components.liquidation, "components.liquidation");
  assertRatio01(result.score.components.range, "components.range");
  assertRatio01(result.score.components.dataQuality, "components.dataQuality");
  assertRatio01(result.score.components.basisRisk, "components.basisRisk");
});

test("Snapshot ratio invariants", () => {
  const result = computeSolSystem(buildSolSummaryInputFixture());

  assertRatio01(result.snapshot.exposures.hedgeRatio, "snapshot.exposures.hedgeRatio");
  assertRatio01(result.snapshot.liquidation.liqBufferRatio ?? 0, "snapshot.liquidation.liqBufferRatio");
  assertRatio01(result.snapshot.range.rangeBufferRatio ?? 0, "snapshot.range.rangeBufferRatio");
  assert.ok(Number.isFinite(result.snapshot.exposures.netSOLDelta));
  assert.ok(!Number.isNaN(Date.parse(result.snapshot.asOfTs)), "snapshot.asOfTs must be parseable");
});

test("buildSolSystemSnapshotFromSummary uses nulls for missing liquidation inputs", () => {
  const snapshot = buildSolSystemSnapshotFromSummary({
    solLong: 100,
    solShort: 95,
    markPrice: 150,
    liqPrice: null,
    leverage: 3.1,
    rangeBufferRatio: 0.1
  });

  assert.equal(snapshot.dataFreshness.hasLiqPrice, false);
  assert.equal(snapshot.liquidation.liqPrice, null);
  assert.equal(snapshot.liquidation.liqBufferRatio, null);
  assert.equal(snapshot.liquidation.leverage, null);
});

test("dataQuality derived from freshness flags", () => {
  const fullFresh = computeSolSystem(buildSolSummaryInputFixture());
  const missingLiq = computeSolSystem(buildSolSummaryInputFixture({ liqPrice: undefined }));
  const zeroLiq = computeSolSystem(buildSolSummaryInputFixture({ liqPrice: 0 }));

  assert.equal(fullFresh.score.components.dataQuality, 1);
  assert.equal(missingLiq.score.components.dataQuality, 0.5);
  assert.ok(missingLiq.score.components.dataQuality < 1);
  assert.equal(missingLiq.snapshot.dataFreshness.hasLiqPrice, false);
  assert.equal(missingLiq.snapshot.liquidation.liqPrice, null);
  assert.equal(missingLiq.snapshot.liquidation.liqBufferRatio, null);
  assert.equal(missingLiq.snapshot.liquidation.leverage, null);
  assert.equal(zeroLiq.snapshot.dataFreshness.hasLiqPrice, false);
  assert.equal(zeroLiq.snapshot.liquidation.liqPrice, null);
  assert.equal(zeroLiq.snapshot.liquidation.liqBufferRatio, null);
  assert.equal(zeroLiq.snapshot.liquidation.leverage, null);
});

test("Range bounds pass-through", () => {
  const withBoundsInput = buildSolSummaryInputFixture();
  const withoutBoundsInput = buildSolSummaryInputFixture({ rangeLower: undefined, rangeUpper: undefined });

  const withBounds = computeSolSystem(withBoundsInput);
  const withoutBounds = computeSolSystem(withoutBoundsInput);

  assert.equal(withBounds.snapshot.range.rangeLower, withBoundsInput.rangeLower);
  assert.equal(withBounds.snapshot.range.rangeUpper, withBoundsInput.rangeUpper);
  assert.equal(withoutBounds.snapshot.range.rangeLower, null);
  assert.equal(withoutBounds.snapshot.range.rangeUpper, null);
});

test("No divergence between computeSolSystem score and direct snapshot+scoring path", () => {
  const input = buildSolSummaryInputFixture();
  const fromCompute = computeSolSystem(input);

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
  const direct = scoreFromPortfolioScore({
    portfolioScore,
    reasons: fromCompute.snapshot.reasons,
    basisRisk: snapshot.basisRisk,
    dataFreshness: snapshot.dataFreshness
  });

  assert.deepEqual(fromCompute.score, direct);
});
