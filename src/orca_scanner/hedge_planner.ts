import {
  getInitializableTickIndex,
  increaseLiquidityQuote,
  priceToTickIndex
} from "@orca-so/whirlpools-core";
import type { HedgePlan, PlansOutput, RankedPool } from "./types.js";

const STABLES = new Set(["USDC", "USDT", "USDG", "PYUSD", "ONYC"]);
const SOL_EQ = new Set(["SOL", "WSOL", "JITOSOL", "MSOL", "BSOL"]);

function baseDeltaFraction(type: string): number {
  if (type === "SOL-STABLE") return 0.45;
  if (type === "LST-STABLE") return 0.25;
  if (type === "SOL-LST") return 0.25;
  if (type === "LST-LST") return 0.1;
  return 0.25;
}

function hedgeMultiplierByRegime(regime: PlansOutput["regime"]["label"]): number {
  if (regime === "LOW") return 0.85;
  if (regime === "MODERATE") return 0.95;
  return 1.0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function baseWidthPct(plan: PlansOutput["plans"][number]): number {
  const base = plan.presets.find((p) => p.label === "Base");
  return Number(base?.halfWidthPct ?? 10);
}

function normSymbol(s: string): string {
  return String(s || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function deriveTokenUsdPrices(row: RankedPool, solSpotUsd: number): { priceAUsd?: number; priceBUsd?: number } {
  const [symA, symB] = row.tokenSymbols;
  const a = normSymbol(symA);
  const b = normSymbol(symB);
  let priceAUsd: number | undefined;
  let priceBUsd: number | undefined;

  if (STABLES.has(a)) priceAUsd = 1;
  if (STABLES.has(b)) priceBUsd = 1;
  if (SOL_EQ.has(a)) priceAUsd = solSpotUsd;
  if (SOL_EQ.has(b)) priceBUsd = solSpotUsd;

  const p = row.spotPrice;
  if (p && p > 0) {
    if (priceBUsd != null && priceAUsd == null) priceAUsd = p * priceBUsd; // price is tokenB per tokenA
    if (priceAUsd != null && priceBUsd == null) priceBUsd = priceAUsd / p;
    if (priceAUsd == null && priceBUsd == null) {
      // As a fallback, anchor stable-like token if present.
      if (STABLES.has(b)) {
        priceBUsd = 1;
        priceAUsd = p;
      } else if (STABLES.has(a)) {
        priceAUsd = 1;
        priceBUsd = 1 / p;
      }
    }
  }
  return { priceAUsd, priceBUsd };
}

export function computeDepositRatioUSD(
  pool: RankedPool,
  lowerTick: number,
  upperTick: number,
  currentSqrtPriceX64: bigint,
  solSpotUsd: number
): {
  tokenARatioUSD: number;
  tokenBRatioUSD: number;
  tokenASymbol: string;
  tokenBSymbol: string;
  riskAssetRatioUSD: number;
  riskAssetSpotUsd: number;
  riskAssetLabel: string;
  source: "orca-sdk";
} {
  const decimals = pool.tokenDecimals;
  if (!decimals) throw new Error("missing token decimals");
  const [decA, decB] = decimals;

  // Use a normalized high-liquidity probe to avoid integer rounding distortions from quoting at liquidity=1.
  const liqProbe = 1_000_000_000_000n;
  const q = increaseLiquidityQuote(liqProbe, 0, currentSqrtPriceX64, lowerTick, upperTick, null, null);
  const amountA = Number(q.tokenEstA) / 10 ** decA / Number(liqProbe);
  const amountB = Number(q.tokenEstB) / 10 ** decB / Number(liqProbe);
  if (!Number.isFinite(amountA) || !Number.isFinite(amountB) || (amountA <= 0 && amountB <= 0)) {
    throw new Error("orca-sdk quote produced zero/invalid token estimates");
  }

  const [symA, symB] = pool.tokenSymbols;
  const { priceAUsd, priceBUsd } = deriveTokenUsdPrices(pool, solSpotUsd);
  if (!(priceAUsd && priceAUsd > 0) || !(priceBUsd && priceBUsd > 0)) {
    throw new Error("missing token USD price conversion");
  }

  const usdA = amountA * priceAUsd;
  const usdB = amountB * priceBUsd;
  const total = usdA + usdB;
  if (!(total > 0)) throw new Error("non-positive USD total");

  const aIsRisk = SOL_EQ.has(normSymbol(symA));
  const bIsRisk = SOL_EQ.has(normSymbol(symB));
  let riskAssetRatioUSD = 0;
  let riskAssetSpotUsd = solSpotUsd;
  let riskAssetLabel = "SOL-equivalent";
  if (aIsRisk && bIsRisk) {
    riskAssetRatioUSD = 1;
    riskAssetLabel = `${symA}+${symB} (SOL-equivalent)`;
  } else if (aIsRisk) {
    riskAssetRatioUSD = usdA / total;
    riskAssetSpotUsd = priceAUsd;
    riskAssetLabel = symA;
  } else if (bIsRisk) {
    riskAssetRatioUSD = usdB / total;
    riskAssetSpotUsd = priceBUsd;
    riskAssetLabel = symB;
  } else {
    throw new Error("no SOL-equivalent side identified");
  }

  return {
    tokenARatioUSD: usdA / total,
    tokenBRatioUSD: usdB / total,
    tokenASymbol: symA,
    tokenBSymbol: symB,
    riskAssetRatioUSD,
    riskAssetSpotUsd,
    riskAssetLabel,
    source: "orca-sdk"
  };
}

export function applyHedgePlans(
  plans: PlansOutput,
  opts: { solSpotUsd?: number; rankingByPool?: Map<string, RankedPool> } = {}
): PlansOutput {
  const funding = plans.regime.fundingAprPct;
  const fundingPenalty = funding != null && funding > 20 ? 0.9 : 1;
  const solSpotUsd = opts.solSpotUsd && Number.isFinite(opts.solSpotUsd) && opts.solSpotUsd > 0 ? opts.solSpotUsd : 200;
  const out = {
    ...plans,
    plans: plans.plans.map((p) => {
      const widthPct = baseWidthPct(p);
      const deltaAdj = clamp(1.0 + (0.1 - widthPct / 20), 0.75, 1.15);
      const heuristicDeltaFraction = baseDeltaFraction(p.type) * deltaAdj;
      const hedgeMultiplier = hedgeMultiplierByRegime(plans.regime.label);
      const row = opts.rankingByPool?.get(p.poolAddress);
      let depositRatioSource: HedgePlan["depositRatioSource"] = "fallback";
      let depositRatioTokenARatioUSD: number | undefined;
      let depositRatioTokenBRatioUSD: number | undefined;
      let depositRatioTokenASymbol: string | undefined;
      let depositRatioTokenBSymbol: string | undefined;
      let depositRatioRiskAssetUSD: number | undefined;
      let approxDeltaFraction = heuristicDeltaFraction;
      let hedgeUSD = 10_000 * approxDeltaFraction * hedgeMultiplier * fundingPenalty;
      let note = "";

      if (
        row &&
        row.tickSpacing != null &&
        row.tickCurrentIndex != null &&
        row.sqrtPriceX64 &&
        row.spotPrice != null &&
        row.tokenDecimals &&
        (p.type === "SOL-STABLE" || p.type === "SOL-LST" || p.type === "LST-STABLE")
      ) {
        try {
          const lowerPrice = row.spotPrice * (1 - widthPct / 100);
          const upperPrice = row.spotPrice * (1 + widthPct / 100);
          let lowerTick = getInitializableTickIndex(
            priceToTickIndex(lowerPrice, row.tokenDecimals[0], row.tokenDecimals[1]),
            row.tickSpacing,
            false
          );
          let upperTick = getInitializableTickIndex(
            priceToTickIndex(upperPrice, row.tokenDecimals[0], row.tokenDecimals[1]),
            row.tickSpacing,
            true
          );
          if (lowerTick >= upperTick) {
            lowerTick = getInitializableTickIndex(row.tickCurrentIndex - row.tickSpacing, row.tickSpacing, false);
            upperTick = getInitializableTickIndex(row.tickCurrentIndex + row.tickSpacing, row.tickSpacing, true);
          }
          const ratio = computeDepositRatioUSD(row, lowerTick, upperTick, BigInt(row.sqrtPriceX64), solSpotUsd);
          depositRatioSource = "orca-sdk";
          depositRatioTokenARatioUSD = Number(ratio.tokenARatioUSD.toFixed(4));
          depositRatioTokenBRatioUSD = Number(ratio.tokenBRatioUSD.toFixed(4));
          depositRatioTokenASymbol = ratio.tokenASymbol;
          depositRatioTokenBSymbol = ratio.tokenBSymbol;
          depositRatioRiskAssetUSD = Number(ratio.riskAssetRatioUSD.toFixed(4));
          approxDeltaFraction = ratio.riskAssetRatioUSD * deltaAdj;
          hedgeUSD = 10_000 * ratio.riskAssetRatioUSD * hedgeMultiplier * fundingPenalty;
          note = "derived from deposit ratio for planned Base range at current price";
        } catch (err) {
          note = `fallback heuristic used: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        note = "fallback heuristic used: missing pool math metadata";
      }

      const spotSol = solSpotUsd;
      const hedgeSOL = hedgeUSD / spotSol;
      const warning =
        funding != null && funding > 25
          ? `Funding APR ${funding.toFixed(1)}% is elevated; trim hedge size or use partial hedge.`
          : undefined;
      const enabled = approxDeltaFraction >= 0.08;
      const hedge: HedgePlan = {
        enabled,
        side: enabled ? "SHORT_SOL" : "NONE",
        deltaEstimateSolPer10kUsd: Number(((10_000 * approxDeltaFraction) / spotSol).toFixed(4)),
        recommendedShortSolPer10kUsd: enabled ? Number(hedgeSOL.toFixed(4)) : 0,
        recommendedShortNotionalUsdPer10kUsd: enabled ? Number(hedgeUSD.toFixed(2)) : 0,
        hedgeMultiplier: Number(hedgeMultiplier.toFixed(2)),
        approxDeltaFraction: Number(approxDeltaFraction.toFixed(4)),
        depositRatioSource,
        depositRatioRiskAssetUSD: depositRatioRiskAssetUSD != null ? Number(depositRatioRiskAssetUSD.toFixed(4)) : undefined,
        depositRatioTokenARatioUSD,
        depositRatioTokenBRatioUSD,
        depositRatioTokenASymbol,
        depositRatioTokenBSymbol,
        hedgeUSDPer10k: enabled ? Number(hedgeUSD.toFixed(2)) : 0,
        hedgeSOLPer10k: enabled ? Number(hedgeSOL.toFixed(4)) : 0,
        fundingAprPct: funding,
        warning,
        note:
          enabled
            ? `${note}; hedge normalized per $10k with regime multiplier and SOL short sizing.`
            : `${note}; no hedge suggested because estimated SOL delta fraction is low.`
      };
      return { ...p, hedge };
    })
  };
  return out;
}
