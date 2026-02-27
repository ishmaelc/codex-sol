import fs from "node:fs/promises";
import path from "node:path";
import {
  computeDeltaScore,
  computeHedgeSafetyScore,
  computeRangeHealthScore,
  computeStabilityScore,
  computeSystemScore
} from "../scoring.js";
import { getOperatorMode, normalizeCadenceHours } from "../operator_mode.js";
import { scoreFromPortfolioScore } from "../../system_engine/score_adapter.js";
import { mapStatusToLabel } from "../../system_engine/label.js";
import type { CanonicalSystemSnapshot, HedgedSystemDefinition, HedgedSystemSnapshot, RiskFlags } from "../types.js";

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asNumLoose(v: unknown): number | null {
  const direct = asNum(v);
  if (direct != null) return direct;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function extractNx8FromStrategyValuations(
  strategyValuations: Array<Record<string, unknown>>,
  nx8Mint: string
): { nx8KaminoQty: number; nx8PriceUsd: number | null } {
  let nx8KaminoQty = 0;
  let nx8PriceUsd: number | null = null;
  for (const s of strategyValuations) {
    const tokenASymbol = String(s?.tokenASymbol ?? "").toUpperCase();
    const tokenBSymbol = String(s?.tokenBSymbol ?? "").toUpperCase();
    const tokenAMint = String(s?.tokenAMint ?? "");
    const tokenBMint = String(s?.tokenBMint ?? "");
    if (tokenASymbol === "NX8" || tokenAMint === nx8Mint) {
      nx8KaminoQty += asNumLoose(s?.tokenAAmountUiFarmsStaked) ?? asNumLoose(s?.tokenAAmountUi) ?? 0;
      nx8PriceUsd = nx8PriceUsd ?? asNumLoose(s?.tokenAPriceUsd);
    }
    if (tokenBSymbol === "NX8" || tokenBMint === nx8Mint) {
      nx8KaminoQty += asNumLoose(s?.tokenBAmountUiFarmsStaked) ?? asNumLoose(s?.tokenBAmountUi) ?? 0;
      nx8PriceUsd = nx8PriceUsd ?? asNumLoose(s?.tokenBPriceUsd);
    }
  }
  return { nx8KaminoQty, nx8PriceUsd };
}

async function fetchBtcPerpExposureFromApi(wallet: string | null, apiBaseUrl?: string): Promise<{
  nx8LongQty: number | null;
  nx8PriceUsd: number | null;
  shortBtcQty: number | null;
  shortBtcNotionalUsd: number | null;
  leverage: number | null;
  liqPrice: number | null;
  markPrice: number | null;
  liqBufferPct: number | null;
} | null> {
  if (!wallet) return null;
  const baseUrl = apiBaseUrl ?? process.env.PORTFOLIO_POSITIONS_API_BASE_URL ?? "http://127.0.0.1:8787";
  const url = `${baseUrl.replace(/\/$/, "")}/api/positions?wallet=${encodeURIComponent(wallet)}&mode=full`;
  const wbtcMint = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
  const nx8Mint = "NX8DuAWprqWAYDvpkkuhKnPfGRXQQhgiw85pCkgvFYk";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const spot = (json.spot as Record<string, unknown> | undefined) ?? {};
    const splTokens = (spot.splTokens as Array<Record<string, unknown>> | undefined) ?? [];
    const nx8SpotQty = splTokens
      .filter((t) => {
        const mint = String(t?.mint ?? "");
        const symbol = String(t?.symbol ?? "").toUpperCase();
        return mint === nx8Mint || symbol === "NX8";
      })
      .reduce((acc, t) => acc + (asNumLoose(t?.amountUi) ?? 0), 0);

    const kaminoLiquidity = (json.kaminoLiquidity as Record<string, unknown> | undefined) ?? {};
    const kaminoLiquidityData = (kaminoLiquidity.data as Record<string, unknown> | undefined) ?? {};
    const strategyValuations = (kaminoLiquidityData.strategyValuations as Array<Record<string, unknown>> | undefined) ?? [];
    let { nx8KaminoQty, nx8PriceUsd } = extractNx8FromStrategyValuations(strategyValuations, nx8Mint);

    // Fallback: summary mode is a separate cache key on the local server and can have fresher Kamino valuations
    // than mode=full if the full payload was cached during an upstream partial response.
    if (nx8KaminoQty <= 0 || nx8PriceUsd == null) {
      try {
        const summaryRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/positions?wallet=${encodeURIComponent(wallet)}&mode=summary`);
        if (summaryRes.ok) {
          const summaryJson = (await summaryRes.json()) as Record<string, unknown>;
          const summaryKamino = (summaryJson.kaminoLiquidity as Record<string, unknown> | undefined) ?? {};
          const summaryVals = (summaryKamino.strategyValuations as Array<Record<string, unknown>> | undefined) ?? [];
          const fallback = extractNx8FromStrategyValuations(summaryVals, nx8Mint);
          if (nx8KaminoQty <= 0) nx8KaminoQty = fallback.nx8KaminoQty;
          if (nx8PriceUsd == null) nx8PriceUsd = fallback.nx8PriceUsd;
        }
      } catch {
        // Keep best-effort values from full payload / env fallbacks.
      }
    }
    const nx8LongQty = nx8SpotQty + nx8KaminoQty;

    const jupiterPerps = (json.jupiterPerps as Record<string, unknown> | undefined) ?? {};
    const jupiterData = (jupiterPerps.data as Record<string, unknown> | undefined) ?? {};
    const raw = (jupiterData.raw as Record<string, unknown> | undefined) ?? {};
    const elements = (raw.elements as Array<Record<string, unknown>> | undefined) ?? [];
    const lev = elements.find((e) => String(e?.type ?? "") === "leverage");
    const levData = (lev?.data as Record<string, unknown> | undefined) ?? {};
    const isolated = (levData.isolated as Record<string, unknown> | undefined) ?? {};
    const positions = (isolated.positions as Array<Record<string, unknown>> | undefined) ?? [];
    const btcPositions = positions.filter((p) => {
      const symbol = String(p?.symbol ?? p?.asset ?? p?.name ?? "").toUpperCase();
      const address = String(p?.address ?? "");
      return symbol.includes("BTC") || address === wbtcMint;
    });
    if (!btcPositions.length) {
      return { nx8LongQty, nx8PriceUsd, shortBtcQty: 0, shortBtcNotionalUsd: 0, leverage: null, liqPrice: null, markPrice: null, liqBufferPct: null };
    }

    let shortBtcQty = 0;
    let shortBtcNotionalUsd = 0;
    let leverage: number | null = null;
    let liqPrice: number | null = null;
    let markPrice: number | null = null;

    for (const p of btcPositions) {
      const side = String(p?.side ?? "").toLowerCase();
      const qty = Math.abs(asNumLoose(p?.size) ?? asNumLoose(p?.quantity) ?? 0);
      const notional = Math.abs(asNumLoose(p?.sizeValue) ?? asNumLoose(p?.notionalUsd) ?? asNumLoose(p?.value) ?? 0);
      if (side === "short") {
        shortBtcQty += qty;
        shortBtcNotionalUsd += notional;
      }
      leverage = leverage ?? asNumLoose(p?.leverage);
      liqPrice = liqPrice ?? asNumLoose(p?.liquidationPrice);
      markPrice = markPrice ?? asNumLoose(p?.markPrice) ?? asNumLoose(p?.entryPrice);
    }

    const liqBufferPct = liqPrice != null && markPrice != null && markPrice > 0 ? ((liqPrice - markPrice) / markPrice) * 100 : null;
    return { nx8LongQty, nx8PriceUsd, shortBtcQty, shortBtcNotionalUsd, leverage, liqPrice, markPrice, liqBufferPct };
  } catch {
    return null;
  }
}

export async function buildNx8SystemSnapshot(context?: { monitorCadenceHours?: number; wallet?: string; apiBaseUrl?: string }): Promise<HedgedSystemSnapshot> {
  const operatorMode = getOperatorMode(normalizeCadenceHours(context?.monitorCadenceHours));
  const baseDir = path.resolve(process.cwd(), "public/data/orca");
  const [rankings, regime] = await Promise.all([
    readJson<Record<string, unknown>>(path.join(baseDir, "pool_rankings.json")),
    readJson<Record<string, unknown>>(path.join(baseDir, "regime_state.json"))
  ]);
  const wallet = context?.wallet ?? process.env.PORTFOLIO_WALLET ?? null;
  const btcPerp = await fetchBtcPerpExposureFromApi(wallet, context?.apiBaseUrl);

  const spotNx8 = btcPerp?.nx8PriceUsd ?? Number(process.env.PORTFOLIO_NX8_PRICE_USD ?? 0);
  const nx8Long = btcPerp?.nx8LongQty ?? Number(process.env.PORTFOLIO_NX8_LONG_UNITS ?? 0);
  const btcShort = btcPerp?.shortBtcQty ?? Number(process.env.PORTFOLIO_BTC_SHORT_UNITS ?? 0);
  const btcPrice = btcPerp?.markPrice ?? Number(process.env.PORTFOLIO_BTC_PRICE_USD ?? 0);
  const leverage = btcPerp?.leverage ?? Number(process.env.PORTFOLIO_BTC_PERP_LEVERAGE ?? 2.5);
  const liqPriceRaw = btcPerp?.liqPrice ?? null;
  const liqPrice = liqPriceRaw != null && liqPriceRaw > 0 ? liqPriceRaw : null;
  const liqBufferPct = liqPrice != null
    ? (btcPerp?.liqBufferPct ?? Number(process.env.PORTFOLIO_BTC_LIQ_BUFFER_PCT ?? 12))
    : null;

  const totalLongBase = nx8Long;
  const totalShortBase = btcShort;
  const nx8Notional = spotNx8 > 0 ? nx8Long * spotNx8 : null;
  const btcNotional = btcPerp?.shortBtcNotionalUsd ?? (btcPrice > 0 ? btcShort * btcPrice : null);
  const netDelta = (nx8Notional ?? nx8Long) - (btcNotional ?? btcShort);

  const firstRank = (((rankings?.topPoolsOverall as unknown[]) ?? [])[0] ?? {}) as Record<string, unknown>;
  const volumeTvl = asNum(firstRank.volumeTvl) ?? 0.2;
  const depth1pctUsd = asNum(firstRank.depthUsd1Pct) ?? 50_000;
  const feeApr = asNum(firstRank.feeAprPct) ?? 6;
  const regimeConfidence = asNum(regime?.confidence) ?? 0.25;

  const deltaScore = computeDeltaScore(netDelta, Math.max(Math.abs(nx8Notional ?? 1) * operatorMode.deltaTolerance, 1));
  const hedgeScoreInputLiqBufferPct = liqBufferPct ?? 0;
  const hedgeScore = computeHedgeSafetyScore({ leverage, liqBufferPct: hedgeScoreInputLiqBufferPct, fundingApr: 8 });
  const rangeScore = computeRangeHealthScore({
    inRange: false,
    distanceToEdgePct: 0,
    widthPct: 0,
    regime: String(regime?.regime ?? "MODERATE")
  });
  const stabilityScore = computeStabilityScore({ volumeTvl, depth1pctUsd, feeApr, regimeConfidence });
  const breakdown = computeSystemScore({ deltaScore, hedgeScore, rangeScore, stabilityScore });

  const riskFlags: RiskFlags = ["PROXY_HEDGE"];
  const missingReasons: string[] = [];
  if ((nx8Notional ?? 0) <= 0) missingReasons.push("MISSING_NX8_NOTIONAL");
  if ((btcNotional ?? 0) <= 0) missingReasons.push("MISSING_WBTC_SHORT_NOTIONAL");
  if ((btcPrice ?? 0) <= 0) missingReasons.push("MISSING_WBTC_MARK_PRICE");
  if (liqPrice == null) missingReasons.push("MISSING_WBTC_LIQ_PRICE");
  if (missingReasons.length > 0) riskFlags.push("MISSING_DATA");
  if (operatorMode.monitorCadenceHours === 48) riskFlags.push("LOW_MONITORING");
  const reasons = Array.from(new Set([...riskFlags, ...missingReasons]));
  const liqBufferRatio = Number.isFinite(Number(liqBufferPct)) ? Number(liqBufferPct) / 100 : null;
  const hedgeRatio = (nx8Notional ?? 0) > 0 && (btcNotional ?? 0) > 0 ? Math.abs((btcNotional ?? 0) / (nx8Notional ?? 1)) : 0;
  const canonicalSnapshot: CanonicalSystemSnapshot = {
    systemId: "NX8_HEDGED_YIELD",
    asOfTs: new Date().toISOString(),
    pricesUsed: {
      mark: btcPrice > 0 ? btcPrice : null,
      baseAsset: "NX8"
    },
    dataFreshness: {
      hasMarkPrice: btcPrice > 0,
      hasLiqPrice: liqPrice != null,
      hasRangeBuffer: false
    },
    exposures: {
      totalLong: totalLongBase,
      totalShort: totalShortBase,
      netDelta,
      hedgeRatio
    },
    liquidation: {
      liqPrice,
      liqBufferRatio,
      leverage: liqPrice == null ? null : leverage
    },
    range: {
      rangeLower: null,
      rangeUpper: null,
      rangeBufferRatio: null
    },
    basisRisk: {
      isProxyHedge: true,
      basisPenalty: 0,
      reasonTag: "PROXY_HEDGE"
    },
    debugMath: {
      liqBufferRatio,
      rangeBufferRatio: null,
      hedgeRatio,
      netDelta,
      hedgeScoreInputLeverage: liqPrice == null ? null : leverage,
      hedgeScoreInputLiqBufferPct,
      hedgeScoreInputFundingApr: 8,
      hedgeComponent: breakdown.hedge
    },
    reasons
  };
  const canonicalScore = scoreFromPortfolioScore({
    portfolioScore: breakdown,
    reasons,
    basisRisk: canonicalSnapshot.basisRisk,
    dataFreshness: canonicalSnapshot.dataFreshness
  });

  return {
    id: "nx8_hedged",
    label: "NX8 Hedged Yield System",
    netDelta,
    totalLong: totalLongBase,
    totalShort: totalShortBase,
    leverage,
    liqBufferPct,
    score: breakdown.weighted,
    breakdown,
    riskFlags,
    canonicalLabel: mapStatusToLabel(breakdown.status),
    canonicalScore,
    canonicalSnapshot,
    updatedAt: new Date().toISOString()
  };
}

export const nx8SystemDefinition: HedgedSystemDefinition = {
  id: "nx8_hedged",
  label: "NX8 Hedged Yield System",
  buildSnapshot: buildNx8SystemSnapshot
};
