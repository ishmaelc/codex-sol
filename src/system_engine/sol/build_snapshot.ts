import type { SolSystemSnapshot } from "../types.js";

export type BuildSolSnapshotInput = {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number | null;
  rangeBufferRatio?: number | null;
  rangeBufferPct?: number | null;
  leverage?: number | null;
  rangeLower?: number | null;
  rangeUpper?: number | null;
  reasons?: string[];
  asOfTs?: string;
};

function toFiniteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function toFiniteOrNull(value: number | null | undefined): number | null {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function buildSolSystemSnapshotFromSummary(input: BuildSolSnapshotInput): SolSystemSnapshot {
  const solLong = toFiniteOrZero(Number(input.solLong));
  const solShort = toFiniteOrZero(Number(input.solShort));
  const markPrice = toFiniteOrZero(Number(input.markPrice));
  const liqPriceRaw = toFiniteOrNull(input.liqPrice);
  const liqPrice = liqPriceRaw != null && liqPriceRaw > 0 ? liqPriceRaw : null;
  const rangeBufferRatio = toFiniteOrNull(input.rangeBufferRatio ?? input.rangeBufferPct);
  const liqBufferRatio = liqPrice != null && markPrice > 0 ? liqPrice / markPrice - 1 : null;

  return {
    systemId: "SOL_HEDGED_YIELD",
    asOfTs: input.asOfTs ?? new Date().toISOString(),
    pricesUsed: {
      sol: markPrice
    },
    dataFreshness: {
      hasMarkPrice: markPrice > 0,
      hasLiqPrice: liqPrice != null,
      hasRangeBuffer: rangeBufferRatio != null
    },
    exposures: {
      totalLongSOL: solLong,
      totalShortSOL: solShort,
      netSOLDelta: solLong - solShort,
      hedgeRatio: solLong > 0 ? Math.abs(solShort / solLong) : 0
    },
    liquidation: {
      liqPrice,
      liqBufferRatio,
      leverage: liqPrice == null ? null : toFiniteOrNull(input.leverage)
    },
    range: {
      rangeLower: toFiniteOrNull(input.rangeLower),
      rangeUpper: toFiniteOrNull(input.rangeUpper),
      rangeBufferRatio
    },
    basisRisk: {
      isProxyHedge: false,
      basisPenalty: 0,
      reasonTag: null
    },
    debugMath: {
      markPrice,
      liqBufferRatio,
      rangeBufferRatio
    },
    reasons: Array.isArray(input.reasons) ? [...input.reasons] : []
  };
}
