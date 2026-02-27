export type RiskTag =
  | "DATA_STALE"
  | "DATA_MISSING"
  | "LOW_DATA_QUALITY"
  | "HEDGE_LOW"
  | "HEDGE_HIGH"
  | "HEDGE_DRIFT_HIGH"
  | "LIQ_BUFFER_LOW"
  | "LIQ_BUFFER_MED"
  | "RANGE_BUFFER_LOW"
  | "RANGE_BUFFER_MED"
  | "PROXY_HEDGE"
  | "BASIS_RISK_HIGH";

export type SystemLabel = "GREEN" | "YELLOW" | "RED";

export type ScoreComponents = {
  hedge: number;
  liquidation: number;
  range: number;
  dataQuality: number;
  basisRisk: number;
};

export type SystemScore = {
  score0to1: number;
  score0to100: number;
  label: SystemLabel;
  reasons: RiskTag[];
  components: ScoreComponents;
};

export type SystemSnapshot = {
  systemId: string;
  asOfMs: number;
  nowMs: number;
  dataQuality: {
    quality0to1: number;
    ageMs?: number;
    missingSources?: string[];
  };
  hedge: {
    hedgePercent: number;
    driftFrac: number;
    isProxyHedge?: boolean;
  };
  liquidation: {
    liqBufferPercent: number;
  };
  range: {
    hasRangeRisk: boolean;
    rangeBufferPercent: number;
  };
  basis: {
    basisRiskEstimate0to1?: number;
  };
};

export type ScoreConfig = {
  weights: ScoreComponents;
  labels: {
    greenMin: number;
    yellowMin: number;
  };
  freshness: {
    staleAfterMs: number;
    unusableAfterMs: number;
    staleClampMax: number;
    unusableClampMax: number;
  };
  hedge: {
    targetPercent: number;
    inBandMinPercent: number;
    inBandMaxPercent: number;
    minPercentForZero: number;
    maxPercentForZero: number;
    driftYellowFrac: number;
    driftRedFrac: number;
  };
  liquidation: {
    yellowBufferPercent: number;
    redBufferPercent: number;
    strongBufferPercent: number;
  };
  range: {
    yellowBufferPercent: number;
    redBufferPercent: number;
    strongBufferPercent: number;
  };
  basis: {
    defaultProxyBasisRiskEstimate0to1: number;
    proxyExtraPenalty: number;
    highRiskCutoff0to1: number;
  };
};

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  weights: {
    hedge: 0.35,
    liquidation: 0.25,
    range: 0.15,
    dataQuality: 0.15,
    basisRisk: 0.1
  },
  labels: {
    greenMin: 0.8,
    yellowMin: 0.6
  },
  freshness: {
    staleAfterMs: 15 * 60 * 1000,
    unusableAfterMs: 90 * 60 * 1000,
    staleClampMax: 0.6,
    unusableClampMax: 0.2
  },
  hedge: {
    targetPercent: 100,
    inBandMinPercent: 85,
    inBandMaxPercent: 115,
    minPercentForZero: 40,
    maxPercentForZero: 180,
    driftYellowFrac: 0.1,
    driftRedFrac: 0.2
  },
  liquidation: {
    yellowBufferPercent: 18,
    redBufferPercent: 10,
    strongBufferPercent: 30
  },
  range: {
    yellowBufferPercent: 8,
    redBufferPercent: 3,
    strongBufferPercent: 16
  },
  basis: {
    defaultProxyBasisRiskEstimate0to1: 0.55,
    proxyExtraPenalty: 0.1,
    highRiskCutoff0to1: 0.6
  }
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function linearRamp(value: number, low: number, high: number): number {
  if (high <= low) return value >= high ? 1 : 0;
  return clamp01((value - low) / (high - low));
}

function withReasonOrder(tags: Set<RiskTag>): RiskTag[] {
  const ordered: RiskTag[] = [
    "DATA_STALE",
    "DATA_MISSING",
    "LOW_DATA_QUALITY",
    "HEDGE_LOW",
    "HEDGE_HIGH",
    "HEDGE_DRIFT_HIGH",
    "LIQ_BUFFER_LOW",
    "LIQ_BUFFER_MED",
    "RANGE_BUFFER_LOW",
    "RANGE_BUFFER_MED",
    "PROXY_HEDGE",
    "BASIS_RISK_HIGH"
  ];
  return ordered.filter((tag) => tags.has(tag));
}

function scoreHedge(snapshot: SystemSnapshot, cfg: ScoreConfig, reasons: Set<RiskTag>): number {
  const hp = snapshot.hedge.hedgePercent;
  let hedgePercentScore = 1;

  if (hp < cfg.hedge.inBandMinPercent) {
    hedgePercentScore = linearRamp(hp, cfg.hedge.minPercentForZero, cfg.hedge.inBandMinPercent);
    reasons.add("HEDGE_LOW");
  } else if (hp > cfg.hedge.inBandMaxPercent) {
    hedgePercentScore = linearRamp(cfg.hedge.maxPercentForZero - hp, 0, cfg.hedge.maxPercentForZero - cfg.hedge.inBandMaxPercent);
    reasons.add("HEDGE_HIGH");
  }

  const drift = Math.abs(snapshot.hedge.driftFrac);
  const driftScore = 1 - linearRamp(drift, cfg.hedge.driftYellowFrac, cfg.hedge.driftRedFrac);
  if (drift >= cfg.hedge.driftYellowFrac) reasons.add("HEDGE_DRIFT_HIGH");

  return clamp01(0.65 * hedgePercentScore + 0.35 * driftScore);
}

function scoreBuffer(
  valuePercent: number,
  yellow: number,
  red: number,
  strong: number,
  lowTag: RiskTag,
  medTag: RiskTag,
  reasons: Set<RiskTag>
): number {
  const v = Number.isFinite(valuePercent) ? valuePercent : 0;
  if (v < red) reasons.add(lowTag);
  else if (v < yellow) reasons.add(medTag);
  return linearRamp(v, red, strong);
}

function mergeConfig(config?: Partial<ScoreConfig>): ScoreConfig {
  return {
    ...DEFAULT_SCORE_CONFIG,
    ...config,
    weights: { ...DEFAULT_SCORE_CONFIG.weights, ...(config?.weights ?? {}) },
    labels: { ...DEFAULT_SCORE_CONFIG.labels, ...(config?.labels ?? {}) },
    freshness: { ...DEFAULT_SCORE_CONFIG.freshness, ...(config?.freshness ?? {}) },
    hedge: { ...DEFAULT_SCORE_CONFIG.hedge, ...(config?.hedge ?? {}) },
    liquidation: { ...DEFAULT_SCORE_CONFIG.liquidation, ...(config?.liquidation ?? {}) },
    range: { ...DEFAULT_SCORE_CONFIG.range, ...(config?.range ?? {}) },
    basis: { ...DEFAULT_SCORE_CONFIG.basis, ...(config?.basis ?? {}) }
  };
}

export function scoreSystem(snapshot: SystemSnapshot, config?: Partial<ScoreConfig>): SystemScore {
  const cfg = mergeConfig(config);
  const reasons = new Set<RiskTag>();

  const missingSources = snapshot.dataQuality.missingSources ?? [];
  if (missingSources.length > 0) reasons.add("DATA_MISSING");

  const ageMs = snapshot.dataQuality.ageMs ?? Math.max(0, snapshot.nowMs - snapshot.asOfMs);
  let dataQualityScore = clamp01(snapshot.dataQuality.quality0to1);
  if (ageMs >= cfg.freshness.unusableAfterMs) {
    reasons.add("DATA_STALE");
    dataQualityScore = Math.min(dataQualityScore, cfg.freshness.unusableClampMax);
  } else if (ageMs >= cfg.freshness.staleAfterMs) {
    reasons.add("DATA_STALE");
    dataQualityScore = Math.min(dataQualityScore, cfg.freshness.staleClampMax);
  }
  if (dataQualityScore < 0.7) reasons.add("LOW_DATA_QUALITY");

  const hedge = scoreHedge(snapshot, cfg, reasons);

  const liquidation = scoreBuffer(
    snapshot.liquidation.liqBufferPercent,
    cfg.liquidation.yellowBufferPercent,
    cfg.liquidation.redBufferPercent,
    cfg.liquidation.strongBufferPercent,
    "LIQ_BUFFER_LOW",
    "LIQ_BUFFER_MED",
    reasons
  );

  const range = snapshot.range.hasRangeRisk
    ? scoreBuffer(
      snapshot.range.rangeBufferPercent,
      cfg.range.yellowBufferPercent,
      cfg.range.redBufferPercent,
      cfg.range.strongBufferPercent,
      "RANGE_BUFFER_LOW",
      "RANGE_BUFFER_MED",
      reasons
    )
    : 1;

  let basisRiskEstimate = clamp(snapshot.basis.basisRiskEstimate0to1 ?? 0, 0, 1);
  if (snapshot.hedge.isProxyHedge) {
    reasons.add("PROXY_HEDGE");
    if (snapshot.basis.basisRiskEstimate0to1 == null) {
      basisRiskEstimate = cfg.basis.defaultProxyBasisRiskEstimate0to1;
    }
    basisRiskEstimate = clamp(basisRiskEstimate + cfg.basis.proxyExtraPenalty, 0, 1);
  }
  if (basisRiskEstimate >= cfg.basis.highRiskCutoff0to1) reasons.add("BASIS_RISK_HIGH");
  const basisRisk = clamp01(1 - basisRiskEstimate);

  const components: ScoreComponents = {
    hedge,
    liquidation,
    range,
    dataQuality: dataQualityScore,
    basisRisk
  };

  const weightSum = Object.values(cfg.weights).reduce((acc, w) => acc + Math.max(0, Number(w) || 0), 0) || 1;
  const normalizedWeights: ScoreComponents = {
    hedge: cfg.weights.hedge / weightSum,
    liquidation: cfg.weights.liquidation / weightSum,
    range: cfg.weights.range / weightSum,
    dataQuality: cfg.weights.dataQuality / weightSum,
    basisRisk: cfg.weights.basisRisk / weightSum
  };

  const score0to1 = clamp01(
    components.hedge * normalizedWeights.hedge
      + components.liquidation * normalizedWeights.liquidation
      + components.range * normalizedWeights.range
      + components.dataQuality * normalizedWeights.dataQuality
      + components.basisRisk * normalizedWeights.basisRisk
  );

  const label: SystemLabel = score0to1 >= cfg.labels.greenMin
    ? "GREEN"
    : score0to1 >= cfg.labels.yellowMin
      ? "YELLOW"
      : "RED";

  return {
    score0to1,
    score0to100: Math.round(score0to1 * 100),
    label,
    reasons: withReasonOrder(reasons),
    components
  };
}
