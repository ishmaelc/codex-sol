import type {
  OnchainPoolEnrichment,
  OrcaApiPool,
  PoolRankingOutput,
  PoolUniverseType,
  RankedPool,
  RegimeState
} from "./types.js";
import type { PoolStabilityMetric } from "./pool_stability.js";

const STABLES = new Set(["USDC", "USDT", "USDG", "PYUSD", "ONYC"]);
const LSTS = new Set(["JITOSOL", "MSOL", "BSOL"]);
const SOL_SYMBOLS = new Set(["SOL", "WSOL"]);

export const ORCA_RANKING_CONFIG = {
  tvlFloorSolStableUsd: 250_000,
  tvlFloorLstUsd: 100_000,
  volume24hFloorUsd: 50_000,
  topN: 10
} as const;

type Candidate = {
  pool: OrcaApiPool;
  universeType: PoolUniverseType;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normSymbol(symbol: string): string {
  return symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function classifyPool(pool: OrcaApiPool): PoolUniverseType | null {
  const a = normSymbol(pool.tokenA.symbol);
  const b = normSymbol(pool.tokenB.symbol);
  const aIsSol = SOL_SYMBOLS.has(a);
  const bIsSol = SOL_SYMBOLS.has(b);
  const aIsStable = STABLES.has(a);
  const bIsStable = STABLES.has(b);
  const aIsLst = LSTS.has(a);
  const bIsLst = LSTS.has(b);

  if ((aIsSol && bIsStable) || (bIsSol && aIsStable)) return "SOL-STABLE";
  if ((aIsSol && bIsLst) || (bIsSol && aIsLst)) return "SOL-LST";
  if ((aIsStable && bIsLst) || (bIsStable && aIsLst)) return "LST-STABLE";
  if (aIsStable && bIsStable) return "STABLE-STABLE";
  if (aIsLst && bIsLst) return "LST-LST";
  return null;
}

function feeAprPct(pool: OrcaApiPool): number {
  if (pool.tvlUsd <= 0) return 0;
  return (pool.stats24h.volume * pool.feeTierRate * 365 * 100) / pool.tvlUsd;
}

function volumeTvl(pool: OrcaApiPool): number {
  return pool.tvlUsd > 0 ? pool.stats24h.volume / pool.tvlUsd : 0;
}

function thresholdTvl(universeType: PoolUniverseType): number {
  return universeType === "SOL-STABLE" || universeType === "STABLE-STABLE"
    ? ORCA_RANKING_CONFIG.tvlFloorSolStableUsd
    : ORCA_RANKING_CONFIG.tvlFloorLstUsd;
}

function explanation(parts: string[]): string {
  return parts.join("; ");
}

function scorePool(args: {
  pool: OrcaApiPool;
  regime: RegimeState;
  universeType: PoolUniverseType;
  onchain?: OnchainPoolEnrichment;
  stability?: PoolStabilityMetric;
}): { score: number; explanation: string; feeApr: number; volumeTvlRatio: number } {
  const { pool, onchain, stability } = args;
  const feeApr = feeAprPct(pool);
  const turnover = volumeTvl(pool);
  const depth1 = onchain?.depthUsd1Pct ?? 0;
  const depth2 = onchain?.depthUsd2Pct ?? 0;
  const depthNorm = clamp((depth1 + 0.5 * depth2) / Math.max(pool.tvlUsd, 1) / 0.08, 0, 1);
  const tvlNorm = clamp(Math.log10(Math.max(pool.tvlUsd, 1)) / 7, 0, 1);
  const feeAprNorm = clamp(feeApr / 120, 0, 1);
  const turnoverNorm = clamp(turnover / 1.25, 0, 1);
  const validationBonus = onchain?.validated ? 0.05 : 0;
  const rewardPenalty = pool.rewardsActiveCount > 0 ? 0.03 : 0;

  const raw =
    0.34 * feeAprNorm + 0.28 * turnoverNorm + 0.2 * depthNorm + 0.13 * tvlNorm + validationBonus - rewardPenalty;
  const baseScore = clamp(raw, 0, 1) * 100;
  const stabilityScore = clamp(stability?.stabilityScore ?? 0.5, 0, 1);
  const score = baseScore * (0.6 + 0.4 * stabilityScore);

  const notes: string[] = [];
  notes.push(`feeAPR ${feeApr.toFixed(1)}%`);
  notes.push(`turnover ${(turnover * 100).toFixed(1)}%/day`);
  if (onchain?.depthUsd1Pct != null) notes.push(`depth±1% ~$${Math.round(onchain.depthUsd1Pct).toLocaleString()}`);
  if (stability?.stabilityScore != null) notes.push(`stability ${(stability.stabilityScore * 100).toFixed(0)}%`);
  if (pool.rewardsActiveCount > 0) notes.push(`${pool.rewardsActiveCount} active reward${pool.rewardsActiveCount > 1 ? "s" : ""}`);
  if (stability?.stabilityNote) notes.push("stability history sparse");

  return {
    score: Number(score.toFixed(2)),
    explanation: explanation(notes),
    feeApr,
    volumeTvlRatio: turnover
  };
}

export function buildPoolRankings(args: {
  fetchedPools: OrcaApiPool[];
  regime: RegimeState;
  onchainByPool: Map<string, OnchainPoolEnrichment>;
  stabilityByPool?: Map<string, PoolStabilityMetric>;
}): PoolRankingOutput {
  const eligible: Candidate[] = [];
  for (const pool of args.fetchedPools) {
    const universeType = classifyPool(pool);
    if (!universeType) continue;
    eligible.push({ pool, universeType });
  }

  const filtered = eligible.filter(({ pool, universeType }) => {
    if (pool.tvlUsd < thresholdTvl(universeType)) return false;
    if (pool.stats24h.volume < ORCA_RANKING_CONFIG.volume24hFloorUsd) return false;
    return true;
  });

  const ranked: RankedPool[] = filtered
    .map(({ pool, universeType }) => {
      const onchain = args.onchainByPool.get(pool.address);
      const stability = args.stabilityByPool?.get(pool.address);
      const scored = scorePool({ pool, regime: args.regime, universeType, onchain, stability });
      return {
        rank: 0,
        poolAddress: pool.address,
        pool: `${pool.tokenA.symbol}/${pool.tokenB.symbol}`,
        type: universeType,
        feeTierPct: Number((pool.feeTierRate * 100).toFixed(4)),
        tvlUsd: Number(pool.tvlUsd.toFixed(2)),
        volume24hUsd: Number(pool.stats24h.volume.toFixed(2)),
        feeAprPct: Number(scored.feeApr.toFixed(2)),
        volumeTvl: Number(scored.volumeTvlRatio.toFixed(4)),
        depthUsd1Pct: onchain?.depthUsd1Pct != null ? Number(onchain.depthUsd1Pct.toFixed(2)) : undefined,
        depthUsd2Pct: onchain?.depthUsd2Pct != null ? Number(onchain.depthUsd2Pct.toFixed(2)) : undefined,
        score: scored.score,
        explanation: scored.explanation,
        validatedOnchain: Boolean(onchain?.validated),
        tokenSymbols: [pool.tokenA.symbol, pool.tokenB.symbol] as [string, string],
        tokenMints: [pool.tokenA.address, pool.tokenB.address] as [string, string],
        tokenDecimals:
          pool.tokenA.decimals != null && pool.tokenB.decimals != null
            ? ([pool.tokenA.decimals, pool.tokenB.decimals] as [number, number])
            : undefined,
        spotPrice: pool.price != null && Number.isFinite(pool.price) ? Number(pool.price.toFixed(8)) : undefined,
        tickSpacing: pool.tickSpacing,
        tickCurrentIndex: pool.tickCurrentIndex,
        sqrtPriceX64: pool.sqrtPriceRaw,
        depthTvl1PctRatio:
          onchain?.depthUsd1Pct != null && pool.tvlUsd > 0 ? Number((onchain.depthUsd1Pct / pool.tvlUsd).toFixed(4)) : undefined,
        stabilityScore: stability?.stabilityScore,
        meanVolTvl7d: stability?.meanVolTvl7d,
        stdevVolTvl7d: stability?.stdevVolTvl7d,
        stabilityNote: stability?.stabilityNote
      };
    })
    .sort((a, b) => b.score - a.score || b.volume24hUsd - a.volume24hUsd)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  const visibleTypes = ["SOL-STABLE", "SOL-LST", "LST-STABLE", "LST-LST"] as const;
  const buckets = {
    "SOL-STABLE": [] as RankedPool[],
    "SOL-LST": [] as RankedPool[],
    "LST-STABLE": [] as RankedPool[],
    "LST-LST": [] as RankedPool[]
  };

  for (const row of ranked) {
    if (visibleTypes.includes(row.type as (typeof visibleTypes)[number])) {
      buckets[row.type as keyof typeof buckets].push(row);
    }
  }
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    buckets[key] = buckets[key].slice(0, ORCA_RANKING_CONFIG.topN);
  }

  const topPoolsOverall = ranked
    .filter((row) => row.type !== "STABLE-STABLE")
    .slice(0, ORCA_RANKING_CONFIG.topN)
    .map((row, idx) => ({ ...row, rank: idx + 1 }));

  return {
    generatedAt: new Date().toISOString(),
    regime: {
      label: args.regime.regime,
      confidence: args.regime.confidence,
      score: args.regime.score
    },
    config: { ...ORCA_RANKING_CONFIG },
    counts: {
      fetchedPools: args.fetchedPools.length,
      eligibleUniverse: eligible.length,
      afterThresholds: filtered.length,
      ranked: topPoolsOverall.length
    },
    pools: topPoolsOverall,
    topPoolsOverall,
    buckets,
    notes: [
      "Universe includes SOL-stable, SOL-LST, LST-STABLE, LST-LST, and internal STABLE-STABLE pools (LSTs limited to jitoSOL/mSOL/bSOL).",
      "STABLE-STABLE pools are kept internally for analysis but excluded from topPoolsOverall/UI display.",
      "Depth values are heuristic approximations until tick-array parsing is implemented."
    ]
  };
}

export function selectUniversePools(pools: OrcaApiPool[]): OrcaApiPool[] {
  return pools.filter((p) => classifyPool(p) !== null);
}

export function selectThresholdPools(pools: OrcaApiPool[]): OrcaApiPool[] {
  return pools.filter((pool) => {
    const universeType = classifyPool(pool);
    if (!universeType) return false;
    if (pool.tvlUsd < thresholdTvl(universeType)) return false;
    if (pool.stats24h.volume < ORCA_RANKING_CONFIG.volume24hFloorUsd) return false;
    return true;
  });
}
