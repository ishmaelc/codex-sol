export type SolSystemSnapshot = {
  solLong: number;
  solShort: number;
  netSol: number;
  hedgeCoveragePct: number;
  liqBufferPct: number;
  rangeBufferPct: number;
  healthScore: number;
  action: string;
};

export function computeSolSystem(params: {
  solLong: number;
  solShort: number;
  markPrice: number;
  liqPrice?: number;
  rangeBufferPct?: number;
}): SolSystemSnapshot {
  const solLong = params.solLong;
  const solShort = params.solShort;
  const netSol = solLong - solShort;

  const hedgeCoveragePct = solLong > 0 ? Math.abs(solShort / solLong) : 0;

  const liqBufferPct = params.liqPrice ? params.liqPrice / params.markPrice - 1 : 0;

  const rangeBufferPct = params.rangeBufferPct ?? 0;

  // Subscores
  const hedgeScore =
    hedgeCoveragePct >= 0.95 && hedgeCoveragePct <= 1.05
      ? 25
      : hedgeCoveragePct >= 0.85 && hedgeCoveragePct <= 1.2
        ? 18
        : hedgeCoveragePct >= 0.7 && hedgeCoveragePct <= 1.4
          ? 10
          : 0;

  const liqScore = liqBufferPct > 0.3 ? 25 : liqBufferPct > 0.2 ? 18 : liqBufferPct > 0.1 ? 10 : 0;

  const rangeScore = rangeBufferPct > 0.1 ? 25 : rangeBufferPct > 0.05 ? 18 : rangeBufferPct > 0.02 ? 10 : 0;

  const liquidityScore = 20; // placeholder until we wire TVL scoring

  const healthScore = hedgeScore + liqScore + rangeScore + liquidityScore;

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

  return {
    solLong,
    solShort,
    netSol,
    hedgeCoveragePct,
    liqBufferPct,
    rangeBufferPct,
    healthScore,
    action
  };
}
