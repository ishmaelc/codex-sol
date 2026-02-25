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

type JsonObj = Record<string, unknown>;

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchPerpExposureFromApi(): Promise<{
  shortSolQty: number | null;
  shortSolNotionalUsd: number | null;
  leverage: number | null;
  liqPrice: number | null;
  markPrice: number | null;
} | null> {
  const wallet = process.env.PORTFOLIO_WALLET;
  if (!wallet) return null;
  const baseUrl = process.env.PORTFOLIO_POSITIONS_API_BASE_URL ?? "http://127.0.0.1:3000";
  const url = `${baseUrl.replace(/\/$/, "")}/api/positions?wallet=${encodeURIComponent(wallet)}&mode=full`;
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
    const solPositions = positions.filter((p) => {
      const symbol = String(p?.symbol ?? p?.asset ?? p?.name ?? "").toUpperCase();
      const address = String(p?.address ?? "").toUpperCase();
      return symbol.includes("SOL") || address.includes("SOL");
    });
    if (!solPositions.length) return { shortSolQty: 0, shortSolNotionalUsd: 0, leverage: null, liqPrice: null, markPrice: null };

    let shortSolQty = 0;
    let shortSolNotionalUsd = 0;
    let leverage: number | null = null;
    let liqPrice: number | null = null;
    let markPrice: number | null = null;

    for (const p of solPositions) {
      const side = String(p?.side ?? "").toLowerCase();
      const qty = Math.abs(asNum(p?.size) ?? asNum(p?.quantity) ?? 0);
      const notional = Math.abs(asNum(p?.sizeValue) ?? asNum(p?.notionalUsd) ?? asNum(p?.value) ?? 0);
      if (side === "short") {
        shortSolQty += qty;
        shortSolNotionalUsd += notional;
      }
      leverage = leverage ?? asNum(p?.leverage);
      liqPrice = liqPrice ?? asNum(p?.liquidationPrice);
      markPrice = markPrice ?? asNum(p?.markPrice) ?? asNum(p?.entryPrice);
    }

    return { shortSolQty, shortSolNotionalUsd, leverage, liqPrice, markPrice };
  } catch {
    return null;
  }
}

export async function buildSolSystemSnapshot(context?: { monitorCadenceHours?: number }): Promise<HedgedSystemSnapshot> {
  const operatorMode = getOperatorMode(normalizeCadenceHours(context?.monitorCadenceHours));
  const baseDir = path.resolve(process.cwd(), "public/data/orca");
  const [plans, shortlist, rankings, regime] = await Promise.all([
    readJson<JsonObj>(path.join(baseDir, "plans.json")),
    readJson<JsonObj>(path.join(baseDir, "shortlist.json")),
    readJson<JsonObj>(path.join(baseDir, "pool_rankings.json")),
    readJson<JsonObj>(path.join(baseDir, "regime_state.json"))
  ]);

  const flags: RiskFlags = [];

  const solPlan = ((plans?.plans as unknown[]) ?? [])
    .find((p) => String((p as JsonObj)?.type ?? "") === "SOL-STABLE") as JsonObj | undefined;
  const hedge = (solPlan?.hedge ?? {}) as JsonObj;
  const spot = asNum(solPlan?.spotPrice) ?? 0;

  const approxDeltaFraction = asNum(hedge.approxDeltaFraction);
  const solPer10k = asNum(hedge.recommendedShortSolPer10kUsd);
  const deployUsd = Number(process.env.PORTFOLIO_SOL_DEPLOY_USD ?? "10000");
  const deployUnits = Number.isFinite(deployUsd) && deployUsd > 0 ? deployUsd / 10_000 : 1;

  let totalLongSol = 0;
  if (solPer10k != null && approxDeltaFraction != null && spot > 0) {
    totalLongSol = (solPer10k / 0.95) * deployUnits;
  } else if (approxDeltaFraction != null && spot > 0) {
    totalLongSol = ((deployUsd * approxDeltaFraction) / spot) * deployUnits;
    flags.push("MISSING_DATA");
  } else {
    const kaminoPlaceholder = Number(process.env.PORTFOLIO_KAMINO_SOL_PLACEHOLDER ?? "0");
    totalLongSol = Number.isFinite(kaminoPlaceholder) ? kaminoPlaceholder : 0;
    flags.push("MISSING_DATA");
  }

  const perp = await fetchPerpExposureFromApi();
  let totalShortSol = perp?.shortSolQty ?? 0;
  if (!perp) {
    totalShortSol = solPer10k != null ? solPer10k * deployUnits : 0;
    flags.push("MISSING_DATA");
  }

  const netSolDelta = totalLongSol - totalShortSol;

  const markPrice = perp?.markPrice ?? spot;
  const liqPrice = perp?.liqPrice ?? null;
  const liqBufferPct = liqPrice != null && markPrice > 0 ? ((liqPrice - markPrice) / markPrice) * 100 : null;

  const basePreset = ((solPlan?.presets as unknown[]) ?? []).find((p) => String((p as JsonObj)?.label ?? "") === "Base") as JsonObj | undefined;
  const widthPct = asNum(basePreset?.halfWidthPct) != null ? (asNum(basePreset?.halfWidthPct) ?? 0) * 2 : null;
  const distPct = asNum(basePreset?.halfWidthPct) ?? null;
  const inRange = true;

  if ((distPct ?? Number.POSITIVE_INFINITY) <= operatorMode.actEdgePct * 100) flags.push("RANGE_EDGE_ACTION");
  else if ((distPct ?? Number.POSITIVE_INFINITY) <= operatorMode.warnEdgePct * 100) flags.push("RANGE_EDGE_WARN");

  const selectedSol = ((shortlist?.selected as unknown[]) ?? []).find((r) => String((r as JsonObj)?.type ?? "") === "SOL-STABLE") as JsonObj | undefined;
  const firstRank = (((rankings?.topPoolsOverall as unknown[]) ?? [])[0] ?? {}) as JsonObj;
  const volumeTvl = asNum(selectedSol?.volume24hUsd) != null && asNum(selectedSol?.tvlUsd)
    ? (asNum(selectedSol?.volume24hUsd) ?? 0) / Math.max(asNum(selectedSol?.tvlUsd) ?? 1, 1)
    : asNum(firstRank?.volumeTvl) ?? 0;
  const depth1pctUsd = asNum(selectedSol?.depthUsd1Pct) ?? asNum(firstRank?.depthUsd1Pct) ?? 0;
  const feeApr = asNum(selectedSol?.feeAprPct) ?? asNum(firstRank?.feeAprPct) ?? 0;
  const regimeConfidence = asNum(regime?.confidence) ?? 0.4;

  const deltaScore = computeDeltaScore(netSolDelta, Math.max(totalLongSol * operatorMode.deltaTolerance, 0.1));
  const hedgeScore = computeHedgeSafetyScore({
    leverage: perp?.leverage ?? 3,
    liqBufferPct: liqBufferPct ?? 0,
    fundingApr: asNum((plans?.regime as JsonObj | undefined)?.fundingAprPct) ?? 10
  });
  const rangeScore = computeRangeHealthScore({
    inRange,
    distanceToEdgePct: distPct ?? 0,
    widthPct: widthPct ?? 0,
    regime: String(regime?.regime ?? "MODERATE")
  });
  const stabilityScore = computeStabilityScore({ volumeTvl, depth1pctUsd, feeApr, regimeConfidence });
  const breakdown = computeSystemScore({ deltaScore, hedgeScore, rangeScore, stabilityScore });

  if (Math.abs(netSolDelta) > Math.max(totalLongSol * 0.25, 0.5)) flags.push("DELTA_DRIFT");
  if ((liqBufferPct ?? 0) < operatorMode.minLiqBufferPct * 100) flags.push("LOW_LIQ_BUFFER");
  if (operatorMode.monitorCadenceHours === 48) flags.push("LOW_MONITORING");
  if ((perp?.leverage ?? 3) > 4) flags.push("HIGH_LEVERAGE");
  if ((asNum((plans?.regime as JsonObj | undefined)?.fundingAprPct) ?? 0) > 20) flags.push("FUNDING_HEADWIND");

  return {
    id: "sol_hedged",
    label: "SOL Hedged Yield System",
    netDelta: netSolDelta,
    totalLong: totalLongSol,
    totalShort: totalShortSol,
    leverage: perp?.leverage ?? null,
    liqBufferPct,
    score: breakdown.weighted,
    breakdown,
    riskFlags: Array.from(new Set(flags)),
    exposures: [
      {
        source: "orca_plans",
        asset: "SOL",
        direction: "long",
        quantityBase: totalLongSol,
        notionalUsd: spot > 0 ? totalLongSol * spot : null,
        confidence: flags.includes("MISSING_DATA") ? "low" : "medium",
        notes: "Long SOL exposure inferred from Orca/Kamino deployment mix."
      },
      {
        source: "api_positions",
        asset: "SOL",
        direction: "short",
        quantityBase: totalShortSol,
        notionalUsd: spot > 0 ? totalShortSol * spot : null,
        confidence: perp ? "medium" : "low",
        notes: perp ? "Derived from /api/positions perp payload." : "Fallback to hedge planner sizing."
      }
    ],
    hedge: {
      source: "jupiter_perps",
      asset: "SOL",
      side: "short",
      quantityBase: totalShortSol,
      notionalUsd: spot > 0 ? totalShortSol * spot : null,
      leverage: perp?.leverage ?? null,
      liqPrice: perp?.liqPrice ?? null,
      markPrice: markPrice || null,
      liqBufferPct
    },
    updatedAt: new Date().toISOString()
  };
}

export const solSystemDefinition: HedgedSystemDefinition = {
  id: "sol_hedged",
  label: "SOL Hedged Yield System",
  buildSnapshot: buildSolSystemSnapshot
};
