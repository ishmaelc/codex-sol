import { scoreSystem, type SystemScore, type SystemSnapshot } from "./lib/scoring/systemScore.js";

export type SolSystemSnapshot = {
  solLong: number;
  solShort: number;
  netSol: number;
  hedgeCoveragePct: number;
  liqBufferPct: number;
  rangeBufferPct: number;
  asOfMs: number;
  nowMs: number;
  priceInputs: {
    solPrice: number;
  };
  dataFreshness: {
    ageMs: number;
    missingSources: string[];
  };
  systemScore: SystemScore;
};

export function buildSolSystemScoreSnapshot(params: {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number;
  rangeBufferPct?: number;
  asOfMs: number;
  nowMs: number;
  dataQuality0to1?: number;
  missingSources?: string[];
}): SystemSnapshot {
  const solLong = Number(params.solLong) || 0;
  const solShort = Number(params.solShort) || 0;
  const absLong = Math.abs(solLong);
  const absShort = Math.abs(solShort);
  const totalExposureAbs = Math.max(absLong, 0.0001);
  const netDelta = solLong - solShort;
  const hedgePercent = (absShort / totalExposureAbs) * 100;
  const driftFrac = Math.abs(netDelta) / totalExposureAbs;

  const liqBufferPercent = Number.isFinite(Number(params.liqPrice)) && params.markPrice > 0
    ? (((Number(params.liqPrice) - params.markPrice) / params.markPrice) * 100)
    : 0;

  return {
    systemId: "sol_hedged",
    asOfMs: params.asOfMs,
    nowMs: params.nowMs,
    dataQuality: {
      quality0to1: Number.isFinite(params.dataQuality0to1) ? Number(params.dataQuality0to1) : 1,
      missingSources: params.missingSources ?? []
    },
    hedge: {
      hedgePercent,
      driftFrac,
      isProxyHedge: false
    },
    liquidation: {
      liqBufferPercent
    },
    range: {
      hasRangeRisk: true,
      rangeBufferPercent: (params.rangeBufferPct ?? 0) * 100
    },
    basis: {
      basisRiskEstimate0to1: 0.1
    }
  };
}

export function computeSolSystem(params: {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number;
  rangeBufferPct?: number;
  asOfMs?: number;
  nowMs?: number;
  dataQuality0to1?: number;
  missingSources?: string[];
}): SolSystemSnapshot {
  const nowMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
  const asOfMs = Number.isFinite(params.asOfMs) ? Number(params.asOfMs) : nowMs;

  const scoringSnapshot = buildSolSystemScoreSnapshot({
    ...params,
    asOfMs,
    nowMs,
    missingSources: params.missingSources ?? []
  });

  const systemScore = scoreSystem(scoringSnapshot);
  const solLong = params.solLong;
  const solShort = params.solShort;

  return {
    solLong,
    solShort,
    netSol: solLong - solShort,
    hedgeCoveragePct: scoringSnapshot.hedge.hedgePercent / 100,
    liqBufferPct: scoringSnapshot.liquidation.liqBufferPercent / 100,
    rangeBufferPct: (params.rangeBufferPct ?? 0),
    asOfMs,
    nowMs,
    priceInputs: {
      solPrice: params.markPrice
    },
    dataFreshness: {
      ageMs: Math.max(0, nowMs - asOfMs),
      missingSources: scoringSnapshot.dataQuality.missingSources ?? []
    },
    systemScore
  };
}
