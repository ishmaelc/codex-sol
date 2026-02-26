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

function asNumLoose(v: unknown): number | null {
  const direct = asNum(v);
  if (direct != null) return direct;
  if (typeof v !== "string") return null;
  const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

async function fetchBtcPerpExposureFromApi(): Promise<{
  shortBtcQty: number | null;
  shortBtcNotionalUsd: number | null;
  leverage: number | null;
  liqPrice: number | null;
  markPrice: number | null;
  liqBufferPct: number | null;
} | null> {
  const wallet = process.env.PORTFOLIO_WALLET;
  if (!wallet) return null;
  const baseUrl = process.env.PORTFOLIO_POSITIONS_API_BASE_URL ?? "http://127.0.0.1:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/api/positions?wallet=${encodeURIComponent(wallet)}&mode=full`;
  const wbtcMint = "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh";
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
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
      return { shortBtcQty: 0, shortBtcNotionalUsd: 0, leverage: null, liqPrice: null, markPrice: null, liqBufferPct: null };
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
    return { shortBtcQty, shortBtcNotionalUsd, leverage, liqPrice, markPrice, liqBufferPct };
  } catch {
    return null;
  }
}

export async function buildNx8SystemSnapshot(context?: { monitorCadenceHours?: number }): Promise<HedgedSystemSnapshot> {
  const operatorMode = getOperatorMode(normalizeCadenceHours(context?.monitorCadenceHours));
  const baseDir = path.resolve(process.cwd(), "public/data/orca");
  const [rankings, regime] = await Promise.all([
    readJson<Record<string, unknown>>(path.join(baseDir, "pool_rankings.json")),
    readJson<Record<string, unknown>>(path.join(baseDir, "regime_state.json"))
  ]);
  const btcPerp = await fetchBtcPerpExposureFromApi();

  const spotNx8 = Number(process.env.PORTFOLIO_NX8_PRICE_USD ?? 0);
  const nx8Long = Number(process.env.PORTFOLIO_NX8_LONG_UNITS ?? 0);
  const btcShort = btcPerp?.shortBtcQty ?? Number(process.env.PORTFOLIO_BTC_SHORT_UNITS ?? 0);
  const btcPrice = btcPerp?.markPrice ?? Number(process.env.PORTFOLIO_BTC_PRICE_USD ?? 0);
  const leverage = btcPerp?.leverage ?? Number(process.env.PORTFOLIO_BTC_PERP_LEVERAGE ?? 2.5);
  const liqBufferPct = btcPerp?.liqBufferPct ?? Number(process.env.PORTFOLIO_BTC_LIQ_BUFFER_PCT ?? 12);

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
  if (operatorMode.monitorCadenceHours === 48) riskFlags.push("LOW_MONITORING");

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
