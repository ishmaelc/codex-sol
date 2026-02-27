import test from "node:test";
import assert from "node:assert/strict";
import { computeSolSystem } from "../../sol_system.js";
import { computeSystemHealth } from "../health/compute_health.js";
import { computeCapitalGuard } from "../capital_guard/compute_capital_guard.js";
import { buildSolSummaryInputFixture } from "./fixtures/sol_summary_input.js";
import {
  computeDeltaScore,
  computeHedgeSafetyScore,
  computeRangeHealthScore,
  computeStabilityScore,
  computeSystemScore
} from "../../portfolio/scoring.js";
import { scoreFromPortfolioScore } from "../score_adapter.js";
import { buildSolSystemSnapshotFromSummary } from "../sol/build_snapshot.js";

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

test("capital guard threshold boundaries", () => {
  const neutralHealth = { overall: "acceptable", hedge: "acceptable", liquidation: "acceptable", range: "acceptable" } as const;

  assert.deepEqual(
    computeCapitalGuard(mkSnapshot({ hedgeRatio: 1, liqBufferRatio: 0.049, rangeBufferRatio: 0.2 }), neutralHealth),
    { level: "critical", triggers: ["immediate_action"] }
  );
  assert.deepEqual(
    computeCapitalGuard(mkSnapshot({ hedgeRatio: 1, liqBufferRatio: 0.09, rangeBufferRatio: 0.2 }), neutralHealth),
    { level: "action", triggers: ["reduce_exposure"] }
  );
  assert.deepEqual(
    computeCapitalGuard(mkSnapshot({ hedgeRatio: 0.49, liqBufferRatio: 0.2, rangeBufferRatio: 0.2 }), neutralHealth),
    { level: "critical", triggers: ["critical_unhedged"] }
  );
  assert.deepEqual(
    computeCapitalGuard(mkSnapshot({ hedgeRatio: 0.69, liqBufferRatio: 0.2, rangeBufferRatio: 0.2 }), neutralHealth),
    { level: "action", triggers: ["rebalance_required"] }
  );
  assert.deepEqual(
    computeCapitalGuard(mkSnapshot({ hedgeRatio: 1, liqBufferRatio: 0.2, rangeBufferRatio: 0.04 }), neutralHealth),
    { level: "warning", triggers: ["range_exit_risk"] }
  );
  assert.deepEqual(
    computeCapitalGuard(
      mkSnapshot({ hedgeRatio: 1, liqBufferRatio: 0.2, rangeBufferRatio: 0.2 }),
      { overall: "critical", hedge: "critical", liquidation: "acceptable", range: "acceptable" }
    ),
    { level: "critical", triggers: ["capital_at_risk"] }
  );
});

test("critical precedence overrides action and warning", () => {
  const guard = computeCapitalGuard(
    mkSnapshot({ hedgeRatio: 0.69, liqBufferRatio: 0.2, rangeBufferRatio: 0.04 }),
    { overall: "critical", hedge: "degraded", liquidation: "acceptable", range: "degraded" }
  );
  assert.equal(guard.level, "critical");
  assert.deepEqual(guard.triggers, ["rebalance_required", "range_exit_risk", "capital_at_risk"]);
});

test("capital guard is deterministic and idempotent", () => {
  const snapshot = mkSnapshot({ hedgeRatio: 0.8, liqBufferRatio: 0.12, rangeBufferRatio: 0.06 });
  const health = computeSystemHealth(snapshot);
  const first = computeCapitalGuard(snapshot, health);
  const second = computeCapitalGuard(snapshot, health);
  assert.deepEqual(first, second);
});

test("score object remains unchanged after capital guard addition", () => {
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

test("health object remains unchanged after capital guard addition", () => {
  const input = buildSolSummaryInputFixture();
  const solSystem = computeSolSystem(input);
  const expectedHealth = computeSystemHealth(solSystem.snapshot);
  assert.deepEqual(solSystem.health, expectedHealth);
});
