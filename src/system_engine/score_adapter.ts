import { mapStatusToLabel } from "./label.js";
import type { SystemScore } from "./types.js";

type PortfolioScoreLike = {
  weighted?: number;
  status?: string;
  hedge?: number;
  range?: number;
  stability?: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function scoreFromPortfolioScore(args: {
  portfolioScore: PortfolioScoreLike;
  reasons?: string[];
  basisRisk?: {
    isProxyHedge?: boolean;
  };
  dataFreshness?: {
    hasMarkPrice?: boolean;
    hasLiqPrice?: boolean;
    hasRangeBuffer?: boolean;
  };
}): SystemScore {
  const rawScore = Number(args.portfolioScore.weighted ?? 0);
  const score0to1 = clamp01(rawScore <= 1 ? rawScore : rawScore / 100);
  const freshness = args.dataFreshness ?? {};
  const presentCount = [freshness.hasMarkPrice, freshness.hasLiqPrice, freshness.hasRangeBuffer].filter(Boolean).length;
  const dataQuality = presentCount === 3 ? 1 : presentCount > 0 ? 0.5 : 0;
  const hasLiq = freshness.hasLiqPrice === true;
  const proxyHedge = args.basisRisk?.isProxyHedge === true;
  const basisRisk = proxyHedge ? 0.7 : 1;
  const reasonSet = new Set(Array.isArray(args.reasons) ? args.reasons : []);
  if (proxyHedge) reasonSet.add("PROXY_HEDGE");

  return {
    score0to1,
    score0to100: Math.round(score0to1 * 100),
    label: mapStatusToLabel(String(args.portfolioScore.status ?? "red")),
    reasons: [...reasonSet],
    components: {
      hedge: clamp01(Number(args.portfolioScore.hedge ?? 0)),
      liquidation: hasLiq ? clamp01(Number(args.portfolioScore.hedge ?? 0)) : 0.5,
      range: clamp01(Number(args.portfolioScore.range ?? 0)),
      dataQuality,
      // Deterministic basis-risk component for canonical scoring.
      basisRisk
    }
  };
}
