export type HealthBand = "strong" | "acceptable" | "degraded" | "critical";

export type HealthResult = {
  overall: HealthBand;
  hedge: HealthBand;
  liquidation: HealthBand;
  range: HealthBand;
};

type HealthSnapshotInput = {
  exposures: {
    hedgeRatio: number;
  };
  liquidation: {
    liqBufferRatio: number | null;
  };
  range: {
    rangeBufferRatio: number | null;
  };
};

const HEALTH_RANK: Record<HealthBand, number> = {
  strong: 0,
  acceptable: 1,
  degraded: 2,
  critical: 3
};

function hedgeBand(hedgeRatio: number): HealthBand {
  if (!Number.isFinite(hedgeRatio)) return "critical";
  if (hedgeRatio >= 0.95 && hedgeRatio <= 1.05) return "strong";
  if (hedgeRatio >= 0.85 && hedgeRatio <= 1.2) return "acceptable";
  if (hedgeRatio >= 0.75 && hedgeRatio <= 1.35) return "degraded";
  return "critical";
}

function liquidationBand(liqBufferRatio: number | null): HealthBand {
  if (liqBufferRatio == null) return "acceptable";
  if (!Number.isFinite(liqBufferRatio)) return "critical";
  if (liqBufferRatio >= 0.3) return "strong";
  if (liqBufferRatio >= 0.15) return "acceptable";
  if (liqBufferRatio >= 0.08) return "degraded";
  return "critical";
}

function rangeBand(rangeBufferRatio: number | null): HealthBand {
  if (rangeBufferRatio == null) return "acceptable";
  if (!Number.isFinite(rangeBufferRatio)) return "critical";
  if (rangeBufferRatio >= 0.08) return "strong";
  if (rangeBufferRatio >= 0.03) return "acceptable";
  if (rangeBufferRatio >= 0.01) return "degraded";
  return "critical";
}

export function computeSystemHealth(snapshot: HealthSnapshotInput): HealthResult {
  const hedge = hedgeBand(snapshot.exposures.hedgeRatio);
  const liquidation = liquidationBand(snapshot.liquidation.liqBufferRatio);
  const range = rangeBand(snapshot.range.rangeBufferRatio);
  const overall = [hedge, liquidation, range].reduce<HealthBand>((worst, current) =>
    HEALTH_RANK[current] > HEALTH_RANK[worst] ? current : worst
  , "strong");

  return {
    overall,
    hedge,
    liquidation,
    range
  };
}
