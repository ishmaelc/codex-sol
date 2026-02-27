import type { SystemScore, SystemSnapshot } from "../lib/scoring/systemScore.js";

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
  scoringSnapshot: SystemSnapshot;
  systemScore: SystemScore;
  priceInputs?: Record<string, number>;
  asOfMs: number;
  nowMs: number;
  exposures?: ExposureLeg[];
  hedge?: HedgeLeg;
  updatedAt: string;
};

export type HedgedSystemDefinition = {
  id: string;
  label: string;
  buildSnapshot: (context?: { monitorCadenceHours?: number }) => Promise<HedgedSystemSnapshot>;
};
