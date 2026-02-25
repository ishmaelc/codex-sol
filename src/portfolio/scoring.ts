import type { SystemScoreBreakdown } from "./types.js";

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function scoreToStatus(score: number): "green" | "yellow" | "orange" | "red" {
  if (score >= 0.8) return "green";
  if (score >= 0.6) return "yellow";
  if (score >= 0.4) return "orange";
  return "red";
}

export function computeDeltaScore(netBaseDelta: number, toleranceBase: number): number {
  if (!Number.isFinite(netBaseDelta) || !Number.isFinite(toleranceBase) || toleranceBase <= 0) return 0;
  const drift = Math.abs(netBaseDelta) / toleranceBase;
  return clamp01(1 - drift);
}

export function computeHedgeSafetyScore(args: { leverage: number; liqBufferPct: number; fundingApr: number }): number {
  const leveragePenalty = clamp01((args.leverage - 1.5) / 3.5);
  const liqSafety = clamp01(args.liqBufferPct / 25);
  const fundingPenalty = clamp01(args.fundingApr / 30);
  return clamp01(liqSafety * 0.55 + (1 - leveragePenalty) * 0.3 + (1 - fundingPenalty) * 0.15);
}

export function computeRangeHealthScore(args: {
  inRange: boolean;
  distanceToEdgePct: number;
  widthPct: number;
  regime: string;
}): number {
  const regimePenalty = String(args.regime).toUpperCase() === "HIGH" ? 0.08 : 0;
  if (!args.inRange) return clamp01(0.1 - regimePenalty);
  const edgeScore = clamp01(args.distanceToEdgePct / 10);
  const widthScore = clamp01(args.widthPct / 35);
  return clamp01(edgeScore * 0.65 + widthScore * 0.35 - regimePenalty);
}

export function computeStabilityScore(args: {
  volumeTvl: number;
  depth1pctUsd: number;
  feeApr: number;
  regimeConfidence: number;
}): number {
  const volScore = clamp01(args.volumeTvl / 1.5);
  const depthScore = clamp01(args.depth1pctUsd / 1_500_000);
  const feeScore = clamp01(args.feeApr / 120);
  const confidenceScore = clamp01(args.regimeConfidence);
  return clamp01(volScore * 0.35 + depthScore * 0.35 + feeScore * 0.2 + confidenceScore * 0.1);
}

export function computeSystemScore(args: {
  deltaScore: number;
  hedgeScore: number;
  rangeScore: number;
  stabilityScore: number;
}): SystemScoreBreakdown {
  const delta = clamp01(args.deltaScore);
  const hedge = clamp01(args.hedgeScore);
  const range = clamp01(args.rangeScore);
  const stability = clamp01(args.stabilityScore);
  const weighted = clamp01(delta * 0.35 + hedge * 0.3 + range * 0.2 + stability * 0.15);

  return {
    delta,
    hedge,
    range,
    stability,
    weighted,
    status: scoreToStatus(weighted)
  };
}
