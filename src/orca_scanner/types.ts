export type OrcaPoolStatsWindow = {
  volume: number;
  fees: number;
  rewards: number;
  yieldOverTvl: number;
};

export type OrcaTokenInfo = {
  address: string;
  symbol: string;
  name?: string;
  decimals?: number;
};

export type OrcaApiPool = {
  address: string;
  poolType: string;
  tickSpacing: number;
  feeRate: number;
  feeTierRate: number;
  liquidityRaw: string;
  liquidity: number;
  sqrtPriceRaw?: string;
  tickCurrentIndex?: number;
  price?: number | null;
  tvlUsd: number;
  tokenA: OrcaTokenInfo;
  tokenB: OrcaTokenInfo;
  stats24h: OrcaPoolStatsWindow;
  stats7d: OrcaPoolStatsWindow;
  stats30d: OrcaPoolStatsWindow;
  rewardsActiveCount: number;
  updatedAt?: string;
};

export type PoolUniverseType =
  | "SOL-STABLE"
  | "SOL-LST"
  | "LST-LST"
  | "LST-STABLE"
  | "STABLE-STABLE";

export type OnchainPoolEnrichment = {
  poolAddress: string;
  validated: boolean;
  validationNote?: string;
  rpcEndpoint: string;
  accountOwner?: string;
  lamports?: number;
  slot?: number;
  depthUsd1Pct?: number;
  depthUsd2Pct?: number;
  depthMethod: "heuristic_no_tick_arrays" | "none";
  depthNote?: string;
};

export type RegimeLabel = "LOW" | "MODERATE" | "HIGH";

export type FundingProxyResult = {
  source: string;
  symbol: string;
  fundingAprPct: number | null;
  rawRate?: number | null;
  ratePeriod?: "hour" | "8h" | "day" | "apr";
  asOf?: string;
  note?: string;
};

export type RegimeMetrics = {
  vol7dPct: number | null;
  vol30dPct: number | null;
  vr: number | null;
  fundingAprPct: number | null;
  volumeTvl24h: number | null;
  volumeTvl7dAvg: number | null;
  volumeTvl30dAvg: number | null;
  volumeTvlTrendRatio: number | null;
  volumeTvlTrendLabel: "rising" | "flat" | "falling" | "unknown";
};

export type RegimeState = {
  generatedAt: string;
  regime: RegimeLabel;
  confidence: number;
  score: number;
  metrics: RegimeMetrics;
  reasons: string[];
  hysteresis: {
    previousRegime?: RegimeLabel;
    previousScore?: number;
    applied: boolean;
  };
  dataSources: {
    spotVol: string;
    funding: string;
    pools: string;
  };
  notes: string[];
};

export type RankedPool = {
  rank: number;
  poolAddress: string;
  pool: string;
  type: PoolUniverseType;
  feeTierPct: number;
  tvlUsd: number;
  volume24hUsd: number;
  feeAprPct: number;
  volumeTvl: number;
  depthUsd1Pct?: number;
  depthUsd2Pct?: number;
  score: number;
  explanation: string;
  validatedOnchain: boolean;
  tokenSymbols: [string, string];
  tokenMints?: [string, string];
  tokenDecimals?: [number, number];
  spotPrice?: number;
  tickSpacing?: number;
  tickCurrentIndex?: number;
  sqrtPriceX64?: string;
  depthTvl1PctRatio?: number;
  stabilityScore?: number;
  meanVolTvl7d?: number;
  stdevVolTvl7d?: number;
  stabilityNote?: string;
};

export type PoolRankingOutput = {
  generatedAt: string;
  regime: {
    label: RegimeLabel;
    confidence: number;
    score: number;
  };
  config: {
    tvlFloorSolStableUsd: number;
    tvlFloorLstUsd: number;
    volume24hFloorUsd: number;
    topN: number;
  };
  counts: {
    fetchedPools: number;
    eligibleUniverse: number;
    afterThresholds: number;
    ranked: number;
  };
  pools: RankedPool[]; // legacy alias for existing UI compatibility
  topPoolsOverall: RankedPool[];
  buckets: Record<Exclude<PoolUniverseType, "STABLE-STABLE">, RankedPool[]>;
  notes: string[];
};

export type ShortlistDecisionReason = {
  code:
    | "REGIME_MATCH"
    | "DEPTH_OK"
    | "FEEAPR_STRONG"
    | "THIN_POOL_REJECT"
    | "TYPE_TARGET"
    | "EXCEPTIONAL_SOL_STABLE"
    | "GUARDRAIL_FAIL";
  message: string;
};

export type ShortlistItem = {
  slot: 1 | 2;
  poolAddress: string;
  pool: string;
  type: Exclude<PoolUniverseType, "STABLE-STABLE">;
  rank: number;
  score: number;
  tvlUsd: number;
  volume24hUsd: number;
  feeAprPct: number;
  depthUsd1Pct?: number;
  depthUsd2Pct?: number;
  depthTvl1PctRatio?: number;
  reasons: ShortlistDecisionReason[];
};

export type ShortlistOutput = {
  generatedAt: string;
  regime: RegimeLabel;
  maxPools: 1;
  selected: ShortlistItem[];
  constraints: {
    minDepthTvl1PctRatio: number;
    minTvlUsd: number;
    minVolume24hUsd: number;
  };
  summary: {
    candidatesConsidered: number;
    selectedCount: number;
  };
  notes: string[];
};

export type RangePreset = {
  label: "Conservative" | "Base" | "Aggressive";
  halfWidthPct: number;
  lowerPct: number;
  upperPct: number;
  lowerPrice?: number;
  upperPrice?: number;
  rationale: string;
};

export type HedgePlan = {
  enabled: boolean;
  side: "SHORT_SOL" | "NONE";
  deltaEstimateSolPer10kUsd: number;
  recommendedShortSolPer10kUsd: number;
  recommendedShortNotionalUsdPer10kUsd: number;
  hedgeMultiplier?: number;
  approxDeltaFraction?: number;
  depositRatioSource?: "orca-sdk" | "fallback";
  depositRatioRiskAssetUSD?: number;
  depositRatioTokenARatioUSD?: number;
  depositRatioTokenBRatioUSD?: number;
  depositRatioTokenASymbol?: string;
  depositRatioTokenBSymbol?: string;
  hedgeUSDPer10k?: number;
  hedgeSOLPer10k?: number;
  fundingAprPct: number | null;
  warning?: string;
  note: string;
};

export type PoolPlan = {
  poolAddress: string;
  pool: string;
  type: Exclude<PoolUniverseType, "STABLE-STABLE">;
  tokenA?: { mint: string; symbol: string; decimals?: number };
  tokenB?: { mint: string; symbol: string; decimals?: number };
  spotPrice?: number;
  volatilityProxyPctAnnual: number;
  regimeWidthMultiplier?: number;
  presets: RangePreset[];
  recommendedPreset?: RangePreset["label"];
  hedge: HedgePlan;
};

export type PlansOutput = {
  generatedAt: string;
  regime: {
    label: RegimeLabel;
    fundingAprPct: number | null;
  };
  plans: PoolPlan[];
  notes: string[];
};

export type AllocationRecommendationItem = {
  poolAddress: string;
  pool: string;
  type: Exclude<PoolUniverseType, "STABLE-STABLE">;
  weightPct: number;
  rationale: string;
};

export type AllocationOutput = {
  generatedAt: string;
  regime: RegimeLabel;
  maxPools: 2;
  allocations: AllocationRecommendationItem[];
  rationale: string[];
  notes: string[];
};

export type AlertSeverity = "info" | "warn" | "critical";
export type AlertKind =
  | "FUNDING_SPIKE"
  | "VOLUME_TVL_COLLAPSE"
  | "TVL_FLIGHT"
  | "DEPTH_COLLAPSE"
  | "NEAR_RANGE_EDGE"
  | "RANGE_EDGE_WARN"
  | "RANGE_EDGE_ACTION";

export type OrcaAlert = {
  id: string;
  severity: AlertSeverity;
  kind: AlertKind;
  poolAddress?: string;
  pool?: string;
  message: string;
  metric?: {
    name: string;
    value: number;
    threshold?: number;
  };
};

export type AlertsOutput = {
  generatedAt: string;
  regime: RegimeLabel;
  alerts: OrcaAlert[];
  notes: string[];
};

export type PerformanceLedgerSnapshot = {
  ts: string;
  regime: RegimeLabel;
  regimeScore: number;
  fundingAprPct: number | null;
  shortlistCount: number;
  shortlistedPools: Array<{
    poolAddress: string;
    pool: string;
    type: string;
    score: number;
    feeAprPct: number;
    volumeTvl: number | null;
  }>;
  alertsCount: number;
};

export type PerformanceSummaryOutput = {
  generatedAt: string;
  lookbackDays: number;
  snapshots: PerformanceLedgerSnapshot[];
  summary: {
    snapshotCount: number;
    avgFundingAprPct: number | null;
    regimeCounts: Record<RegimeLabel, number>;
    latestSnapshotTs?: string;
  };
  notes: string[];
};
