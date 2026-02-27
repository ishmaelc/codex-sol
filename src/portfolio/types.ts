import type { SystemLabel, SystemScore } from "../system_engine/types.js";
import type { HealthResult } from "../system_engine/health/compute_health.js";
import type { CapitalGuardResult } from "../system_engine/capital_guard/compute_capital_guard.js";

export type ExposureLeg = {
  source: string;
  asset: string;
  direction: "long" | "short";
  quantityBase: number | null;
  notionalUsd: number | null;
  confidence: "high" | "medium" | "low";
  notes?: string;
};

export type HedgeLeg = {
  source: string;
  asset: string;
  side: "short" | "long";
  quantityBase: number | null;
  notionalUsd: number | null;
  leverage: number | null;
  liqPrice: number | null;
  markPrice: number | null;
  liqBufferPct: number | null;
};

export type RiskFlags = Array<
  | "MISSING_DATA"
  | "PROXY_HEDGE"
  | "OUT_OF_RANGE"
  | "LOW_LIQ_BUFFER"
  | "HIGH_LEVERAGE"
  | "FUNDING_HEADWIND"
  | "DELTA_DRIFT"
  | "LOW_MONITORING"
  | "RANGE_EDGE_WARN"
  | "RANGE_EDGE_ACTION"
>;

export type SystemScoreBreakdown = {
  delta: number;
  hedge: number;
  range: number;
  stability: number;
  weighted: number;
  status: "green" | "yellow" | "orange" | "red";
};

export type HedgedSystemSnapshot = {
  id: string;
  label: string;
  netDelta: number;
  totalLong: number;
  totalShort: number;
  leverage: number | null;
  liqBufferPct: number | null;
  score: number;
  breakdown: SystemScoreBreakdown;
  riskFlags: RiskFlags;
  exposures?: ExposureLeg[];
  hedge?: HedgeLeg;
  canonicalLabel?: SystemLabel;
  canonicalScore?: SystemScore;
  health?: HealthResult;
  capitalGuard?: CapitalGuardResult;
  canonicalSnapshot?: CanonicalSystemSnapshot;
  updatedAt: string;
};

export type CanonicalSystemSnapshot = {
  systemId: string;
  asOfTs: string | null;
  pricesUsed: {
    mark: number | null;
    baseAsset?: string | null;
  };
  dataFreshness: {
    hasMarkPrice: boolean;
    hasLiqPrice: boolean;
    hasRangeBuffer: boolean;
  };
  exposures: {
    totalLong: number;
    totalShort: number;
    netDelta: number;
    hedgeRatio: number;
  };
  liquidation: {
    liqPrice: number | null;
    liqBufferRatio: number | null;
    leverage: number | null;
  };
  range: {
    rangeLower: number | null;
    rangeUpper: number | null;
    rangeBufferRatio: number | null;
  };
  basisRisk: {
    isProxyHedge: boolean;
    basisPenalty: number;
    reasonTag: string | null;
  };
  debugMath: {
    liqBufferRatio: number | null;
    rangeBufferRatio: number | null;
    [key: string]: number | null;
  };
  reasons: string[];
};

export type HedgedSystemDefinition = {
  id: string;
  label: string;
  buildSnapshot: (context?: { monitorCadenceHours?: number }) => Promise<HedgedSystemSnapshot>;
};
