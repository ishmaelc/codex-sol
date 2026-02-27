import {
  computeDeltaScore,
  computeHedgeSafetyScore,
  computeRangeHealthScore,
  computeStabilityScore,
  computeSystemScore
} from "./portfolio/scoring.js";
import { scoreFromPortfolioScore } from "./system_engine/score_adapter.js";
import { computeSystemHealth, type HealthResult } from "./system_engine/health/compute_health.js";
import { computeCapitalGuard, type CapitalGuardResult } from "./system_engine/capital_guard/compute_capital_guard.js";
import { buildSolSystemSnapshotFromSummary } from "./system_engine/sol/build_snapshot.js";
import type { SolSystemSnapshot as CanonicalSolSystemSnapshot, SystemScore } from "./system_engine/types.js";

export type SolSystemSnapshot = {
  solLong: number;
  solShort: number;
  netSol: number;
  hedgeCoveragePct: number;
  liqBufferPct: number;
  rangeBufferPct: number;
  healthScore: number;
  health: HealthResult;
  capitalGuard: CapitalGuardResult;
  action: string;
  score: SystemScore;
  scoreObj: SystemScore;
  snapshot: CanonicalSolSystemSnapshot;
};

function dedupeReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons.filter((reason) => reason.length > 0)));
}

export function computeSolSystem(params: {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number;
  rangeBufferPct?: number;
  rangeLower?: number;
  rangeUpper?: number;
  leverage?: number;
  reasons?: string[];
}): SolSystemSnapshot {
  const snapshot = buildSolSystemSnapshotFromSummary({
    solLong: params.solLong,
    solShort: params.solShort,
    markPrice: params.markPrice,
    liqPrice: params.liqPrice,
    rangeBufferRatio: params.rangeBufferPct,
    rangeLower: params.rangeLower,
    rangeUpper: params.rangeUpper,
    leverage: params.leverage,
    reasons: params.reasons
  });
  const deltaScore = computeDeltaScore(snapshot.exposures.netSOLDelta, Math.max(snapshot.exposures.totalLongSOL * 0.3, 0.1));
  const hedgeScore = computeHedgeSafetyScore({
    leverage: Number.isFinite(Number(snapshot.liquidation.leverage)) ? Number(snapshot.liquidation.leverage) : 3,
    liqBufferPct: Number(snapshot.liquidation.liqBufferRatio ?? 0) * 100,
    fundingApr: 10
  });
  const rangeScore = computeRangeHealthScore({
    inRange: true,
    distanceToEdgePct: Number(snapshot.range.rangeBufferRatio ?? 0) * 100,
    widthPct: Number(snapshot.range.rangeBufferRatio ?? 0) * 200,
    regime: "MODERATE"
  });
  const stabilityScore = computeStabilityScore({
    volumeTvl: 0,
    depth1pctUsd: 0,
    feeApr: 0,
    regimeConfidence: 0.4
  });
  const portfolioScore = computeSystemScore({ deltaScore, hedgeScore, rangeScore, stabilityScore });
  const solLong = snapshot.exposures.totalLongSOL;
  const solShort = snapshot.exposures.totalShortSOL;
  const netSol = snapshot.exposures.netSOLDelta;
  const hedgeCoveragePct = snapshot.exposures.hedgeRatio;
  const liqBufferPct = snapshot.debugMath.liqBufferRatio ?? 0;
  const rangeBufferPct = snapshot.debugMath.rangeBufferRatio ?? 0;

  let action = "No action";

  if (liqBufferPct < 0.15) {
    action = "Add collateral";
  } else if (hedgeCoveragePct < 0.85) {
    action = "Increase SOL short";
  } else if (hedgeCoveragePct > 1.2) {
    action = "Reduce SOL short";
  } else if (rangeBufferPct < 0.03) {
    action = "Prepare range rebalance";
  }
  const reasons = dedupeReasons([
    ...(snapshot.reasons ?? []),
    ...(action === "Increase SOL short" ? ["UNDERHEDGED"] : [])
  ]);
  const nextSnapshot: CanonicalSolSystemSnapshot = {
    ...snapshot,
    reasons
  };
  const score = scoreFromPortfolioScore({
    portfolioScore,
    reasons,
    basisRisk: nextSnapshot.basisRisk,
    dataFreshness: nextSnapshot.dataFreshness
  });
  const health = computeSystemHealth(nextSnapshot);
  const capitalGuard = computeCapitalGuard(nextSnapshot, health);
  const healthScore = score.score0to100;

  return {
    solLong,
    solShort,
    netSol,
    hedgeCoveragePct,
    liqBufferPct,
    rangeBufferPct,
    healthScore,
    health,
    capitalGuard,
    action,
    score,
    // Strict mirror invariant for UI/API compatibility: scoreObj must never diverge from score.
    scoreObj: score,
    snapshot: nextSnapshot
  };
}
