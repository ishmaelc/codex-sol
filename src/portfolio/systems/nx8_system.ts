import fs from "node:fs/promises";
import path from "node:path";
import {
  computeDeltaScore,
  computeHedgeSafetyScore,
  computeRangeHealthScore,
  computeStabilityScore,
  computeSystemScore
} from "../scoring.js";
import type { HedgedSystemDefinition, HedgedSystemSnapshot, RiskFlags } from "../types.js";

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

export async function buildNx8SystemSnapshot(): Promise<HedgedSystemSnapshot> {
  const baseDir = path.resolve(process.cwd(), "public/data/orca");
  const [rankings, regime] = await Promise.all([
    readJson<Record<string, unknown>>(path.join(baseDir, "pool_rankings.json")),
    readJson<Record<string, unknown>>(path.join(baseDir, "regime_state.json"))
  ]);

  const spotNx8 = Number(process.env.PORTFOLIO_NX8_PRICE_USD ?? 0);
  const nx8Long = Number(process.env.PORTFOLIO_NX8_LONG_UNITS ?? 0);
  const btcShort = Number(process.env.PORTFOLIO_BTC_SHORT_UNITS ?? 0);
  const btcPrice = Number(process.env.PORTFOLIO_BTC_PRICE_USD ?? 0);
  const leverage = Number(process.env.PORTFOLIO_BTC_PERP_LEVERAGE ?? 2.5);
  const liqBufferPct = Number(process.env.PORTFOLIO_BTC_LIQ_BUFFER_PCT ?? 12);

  const totalLongBase = nx8Long;
  const totalShortBase = btcShort;
  const nx8Notional = spotNx8 > 0 ? nx8Long * spotNx8 : null;
  const btcNotional = btcPrice > 0 ? btcShort * btcPrice : null;
  const netDelta = (nx8Notional ?? nx8Long) - (btcNotional ?? btcShort);

  const firstRank = (((rankings?.topPoolsOverall as unknown[]) ?? [])[0] ?? {}) as Record<string, unknown>;
  const volumeTvl = asNum(firstRank.volumeTvl) ?? 0.2;
  const depth1pctUsd = asNum(firstRank.depthUsd1Pct) ?? 50_000;
  const feeApr = asNum(firstRank.feeAprPct) ?? 6;
  const regimeConfidence = asNum(regime?.confidence) ?? 0.25;

  const deltaScore = computeDeltaScore(netDelta, Math.max(Math.abs(nx8Notional ?? 1) * 0.3, 1));
  const hedgeScore = computeHedgeSafetyScore({ leverage, liqBufferPct, fundingApr: 8 });
  const rangeScore = computeRangeHealthScore({
    inRange: false,
    distanceToEdgePct: 0,
    widthPct: 0,
    regime: String(regime?.regime ?? "MODERATE")
  });
  const stabilityScore = computeStabilityScore({ volumeTvl, depth1pctUsd, feeApr, regimeConfidence });
  const breakdown = computeSystemScore({ deltaScore, hedgeScore, rangeScore, stabilityScore });

  const riskFlags: RiskFlags = ["PROXY_HEDGE", "MISSING_DATA"];

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
    updatedAt: new Date().toISOString()
  };
}

export const nx8SystemDefinition: HedgedSystemDefinition = {
  id: "nx8_hedged",
  label: "NX8 Hedged Yield System",
  buildSnapshot: buildNx8SystemSnapshot
};
