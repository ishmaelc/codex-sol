import type { PlansOutput, PoolPlan, RangePreset, RankedPool, RegimeState, ShortlistOutput } from "./types.js";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function weeklySigmaPctFromAnnual(volAnnualPct: number): number {
  return volAnnualPct / Math.sqrt(52);
}

function volProxyByType(type: string, regime: RegimeState): number {
  const solVol = regime.metrics.vol30dPct ?? regime.metrics.vol7dPct ?? 60;
  if (type === "SOL-STABLE") return solVol;
  if (type === "SOL-LST") return clamp(solVol * 0.3, 8, 40);
  if (type === "LST-STABLE") return clamp(solVol * 0.45, 10, 60);
  if (type === "LST-LST") return clamp(solVol * 0.16, 3, 25);
  return solVol;
}

function multipliers(type: string): [number, number, number] {
  if (type === "SOL-STABLE") return [0.8, 1.2, 1.8];
  if (type === "LST-STABLE") return [0.9, 1.35, 2.0];
  if (type === "SOL-LST") return [0.7, 1.1, 1.6];
  return [0.6, 0.9, 1.3];
}

function regimeWidthMultiplier(regime: RegimeState["regime"]): number {
  if (regime === "LOW") return 0.85;
  if (regime === "HIGH") return 1.25;
  return 1.0;
}

function applyWeeklyActiveBaseConstraints(type: string, regime: RegimeState["regime"], label: RangePreset["label"], width: number): number {
  let w = width;
  if (label === "Base" && type === "SOL-STABLE") {
    const minBase = regime === "LOW" ? 4 : 5;
    const maxBase = regime === "HIGH" ? 20 : 20;
    w = clamp(w, minBase, maxBase);
  }
  return w;
}

function buildPresets(
  spotPrice: number | undefined,
  volAnnualPct: number,
  type: string,
  regime: RegimeState["regime"]
): RangePreset[] {
  const sigmaW = weeklySigmaPctFromAnnual(volAnnualPct);
  const [m1, m2, m3] = multipliers(type);
  const regimeMult = regimeWidthMultiplier(regime);
  const labels: Array<{ label: RangePreset["label"]; m: number }> = [
    { label: "Conservative", m: m1 },
    { label: "Base", m: m2 },
    { label: "Aggressive", m: m3 }
  ];
  return labels.map(({ label, m }) => {
    let halfWidthPct = sigmaW * m * regimeMult;
    halfWidthPct = applyWeeklyActiveBaseConstraints(type, regime, label, halfWidthPct);
    halfWidthPct = clamp(halfWidthPct, 2, 30);
    const lowerPct = -Number(halfWidthPct.toFixed(2));
    const upperPct = Number(halfWidthPct.toFixed(2));
    return {
      label,
      halfWidthPct: Number(halfWidthPct.toFixed(2)),
      lowerPct,
      upperPct,
      lowerPrice: spotPrice ? Number((spotPrice * (1 - halfWidthPct / 100)).toFixed(6)) : undefined,
      upperPrice: spotPrice ? Number((spotPrice * (1 + halfWidthPct / 100)).toFixed(6)) : undefined,
      rationale: `~${m.toFixed(1)}x weekly sigma proxy from ${type} volatility, scaled by regime`
    };
  });
}

export function buildRangePlans(args: {
  shortlist: ShortlistOutput;
  regime: RegimeState;
  spotByPool: Map<string, number | undefined>;
  rankingByPool?: Map<string, RankedPool>;
}): Omit<PlansOutput, "notes"> {
  const widthMult = regimeWidthMultiplier(args.regime.regime);
  const plans: PoolPlan[] = args.shortlist.selected.map((s) => {
    const volProxy = volProxyByType(s.type, args.regime);
    const spot = args.spotByPool.get(s.poolAddress);
    const row = args.rankingByPool?.get(s.poolAddress);
    return {
      poolAddress: s.poolAddress,
      pool: s.pool,
      type: s.type,
      tokenA:
        row?.tokenSymbols?.[0]
          ? {
              mint: String((row).tokenMints?.[0] ?? ""),
              symbol: String(row.tokenSymbols[0] ?? ""),
              decimals: row.tokenDecimals?.[0]
            }
          : undefined,
      tokenB:
        row?.tokenSymbols?.[1]
          ? {
              mint: String((row).tokenMints?.[1] ?? ""),
              symbol: String(row.tokenSymbols[1] ?? ""),
              decimals: row.tokenDecimals?.[1]
            }
          : undefined,
      spotPrice: spot,
      volatilityProxyPctAnnual: Number(volProxy.toFixed(2)),
      regimeWidthMultiplier: widthMult,
      presets: buildPresets(spot, volProxy, s.type, args.regime.regime),
      hedge: {
        enabled: false,
        side: "NONE",
        deltaEstimateSolPer10kUsd: 0,
        recommendedShortSolPer10kUsd: 0,
        recommendedShortNotionalUsdPer10kUsd: 0,
        hedgeMultiplier: 0,
        approxDeltaFraction: 0,
        hedgeUSDPer10k: 0,
        hedgeSOLPer10k: 0,
        fundingAprPct: args.regime.metrics.fundingAprPct,
        note: "Filled by hedge planner"
      }
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    regime: {
      label: args.regime.regime,
      fundingAprPct: args.regime.metrics.fundingAprPct
    },
    plans
  };
}
