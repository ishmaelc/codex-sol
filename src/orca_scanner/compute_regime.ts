import fs from "node:fs/promises";
import path from "node:path";
import type { FundingProxyResult, OrcaApiPool, RegimeLabel, RegimeMetrics, RegimeState } from "./types.js";

type PricePoint = { t: number; p: number };

function toNum(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function fetchSolDailyPrices(days = 45): Promise<PricePoint[]> {
  const toSec = Math.floor(Date.now() / 1000);
  const fromSec = toSec - days * 24 * 60 * 60;
  const url = `https://api.coingecko.com/api/v3/coins/solana/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`coingecko-sol:${res.status}:${body.slice(0, 200)}`);
  }
  const payload = (await res.json()) as { prices?: Array<[number, number]> };
  const hourly = (Array.isArray(payload.prices) ? payload.prices : [])
    .map(([t, p]) => ({ t: Number(t), p: Number(p) }))
    .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.p) && x.p > 0)
    .sort((a, b) => a.t - b.t);

  const dayMap = new Map<string, PricePoint>();
  for (const pt of hourly) {
    const day = new Date(pt.t).toISOString().slice(0, 10);
    dayMap.set(day, pt);
  }
  return [...dayMap.values()].sort((a, b) => a.t - b.t);
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function realizedVolPctAnnualized(prices: PricePoint[], lookbackDays: number): number | null {
  if (prices.length < lookbackDays + 1) return null;
  const slice = prices.slice(-1 * (lookbackDays + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i += 1) {
    const r = Math.log(slice[i].p / slice[i - 1].p);
    if (Number.isFinite(r)) rets.push(r);
  }
  if (rets.length < Math.max(3, lookbackDays - 2)) return null;
  return stddev(rets) * Math.sqrt(365) * 100;
}

type AggregateTurnover = {
  volumeTvl24h: number | null;
  volumeTvl7dAvg: number | null;
  volumeTvl30dAvg: number | null;
  trendRatio: number | null;
  trendLabel: "rising" | "flat" | "falling" | "unknown";
};

function aggregateTurnover(pools: OrcaApiPool[]): AggregateTurnover {
  const universe = pools.filter((p) => p.tvlUsd > 0);
  if (universe.length === 0) {
    return {
      volumeTvl24h: null,
      volumeTvl7dAvg: null,
      volumeTvl30dAvg: null,
      trendRatio: null,
      trendLabel: "unknown"
    };
  }
  const tvl = universe.reduce((acc, p) => acc + p.tvlUsd, 0);
  const v24 = universe.reduce((acc, p) => acc + p.stats24h.volume, 0);
  const v7avg = universe.reduce((acc, p) => acc + p.stats7d.volume / 7, 0);
  const v30avg = universe.reduce((acc, p) => acc + p.stats30d.volume / 30, 0);

  const volumeTvl24h = tvl > 0 ? v24 / tvl : null;
  const volumeTvl7dAvg = tvl > 0 ? v7avg / tvl : null;
  const volumeTvl30dAvg = tvl > 0 ? v30avg / tvl : null;
  const trendRatio =
    volumeTvl7dAvg != null && volumeTvl30dAvg != null && volumeTvl30dAvg > 0
      ? volumeTvl7dAvg / volumeTvl30dAvg
      : null;
  const trendLabel =
    trendRatio == null ? "unknown" : trendRatio > 1.15 ? "rising" : trendRatio < 0.9 ? "falling" : "flat";

  return { volumeTvl24h, volumeTvl7dAvg, volumeTvl30dAvg, trendRatio, trendLabel };
}

function normalize(value: number | null, lo: number, hi: number): number {
  if (value == null || !Number.isFinite(value)) return 0.5;
  if (hi <= lo) return 0.5;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

async function readPreviousRegimeState(): Promise<Partial<RegimeState> | null> {
  const filepath = path.resolve(process.cwd(), "public/data/orca/regime_state.json");
  try {
    const raw = await fs.readFile(filepath, "utf8");
    return JSON.parse(raw) as Partial<RegimeState>;
  } catch {
    return null;
  }
}

function applyHysteresis(rawScore: number, previous: Partial<RegimeState> | null): { label: RegimeLabel; applied: boolean } {
  const highCut = 0.72;
  const lowCut = 0.38;

  let proposed: RegimeLabel = rawScore >= highCut ? "HIGH" : rawScore <= lowCut ? "LOW" : "MODERATE";
  const prev = previous?.regime;
  if (!prev) return { label: proposed, applied: false };

  if (prev === "HIGH" && rawScore >= highCut - 0.05) proposed = "HIGH";
  if (prev === "LOW" && rawScore <= lowCut + 0.05) proposed = "LOW";
  if (prev === "MODERATE") {
    if (rawScore > highCut + 0.03) proposed = "HIGH";
    else if (rawScore < lowCut - 0.03) proposed = "LOW";
    else proposed = "MODERATE";
  }
  return { label: proposed, applied: proposed !== (rawScore >= highCut ? "HIGH" : rawScore <= lowCut ? "LOW" : "MODERATE") };
}

export async function computeRegimeState(args: {
  poolsForTurnover: OrcaApiPool[];
  funding: FundingProxyResult;
}): Promise<RegimeState> {
  const prices = await fetchSolDailyPrices(60);
  const vol7d = realizedVolPctAnnualized(prices, 7);
  const vol30d = realizedVolPctAnnualized(prices, 30);
  const vr = vol7d != null && vol30d != null && vol30d > 0 ? vol7d / vol30d : null;
  const turnover = aggregateTurnover(args.poolsForTurnover);
  const fundingApr = toNum(args.funding.fundingAprPct);

  const volAbsNorm = normalize(vol30d, 35, 110);
  const vrNorm = normalize(vr, 0.8, 1.5);
  const fundingNorm = normalize(Math.abs(fundingApr ?? 0), 5, 80);
  const trendNorm = normalize(turnover.trendRatio, 0.9, 1.25);

  const rawScore = 0.38 * volAbsNorm + 0.26 * vrNorm + 0.18 * fundingNorm + 0.18 * trendNorm;
  const previous = await readPreviousRegimeState();
  const hysteresis = applyHysteresis(rawScore, previous);

  const reasons: string[] = [];
  if (vol30d != null) reasons.push(`30d realized vol ${vol30d.toFixed(1)}%`);
  if (vr != null) reasons.push(`VR ${vr.toFixed(2)} (${vr > 1 ? "accelerating" : "cooling"} short-term vol)`);
  if (fundingApr != null) reasons.push(`SOL perp funding proxy ${fundingApr.toFixed(1)}% APR`);
  if (turnover.trendRatio != null) reasons.push(`Volume/TVL trend ${turnover.trendLabel} (${turnover.trendRatio.toFixed(2)}x)`);

  const confidence = Math.max(
    0.1,
    Math.min(
      0.99,
      0.35 +
        (vol7d != null ? 0.2 : 0) +
        (vol30d != null ? 0.2 : 0) +
        (vr != null ? 0.1 : 0) +
        (fundingApr != null ? 0.05 : 0) +
        (turnover.trendRatio != null ? 0.1 : 0)
    )
  );

  const metrics: RegimeMetrics = {
    vol7dPct: vol7d,
    vol30dPct: vol30d,
    vr,
    fundingAprPct: fundingApr,
    volumeTvl24h: turnover.volumeTvl24h,
    volumeTvl7dAvg: turnover.volumeTvl7dAvg,
    volumeTvl30dAvg: turnover.volumeTvl30dAvg,
    volumeTvlTrendRatio: turnover.trendRatio,
    volumeTvlTrendLabel: turnover.trendLabel
  };

  return {
    generatedAt: new Date().toISOString(),
    regime: hysteresis.label,
    confidence: Number(confidence.toFixed(3)),
    score: Number(rawScore.toFixed(4)),
    metrics,
    reasons,
    hysteresis: {
      previousRegime:
        previous?.regime === "LOW" || previous?.regime === "MODERATE" || previous?.regime === "HIGH"
          ? previous.regime
          : undefined,
      previousScore: toNum(previous?.score) ?? undefined,
      applied: hysteresis.applied
    },
    dataSources: {
      spotVol: "coingecko:solana",
      funding: args.funding.source,
      pools: "orca:v2/solana/pools"
    },
    notes: [
      "Volume/TVL trend is derived from the filtered Orca SOL/LST/stable universe aggregate.",
      "Funding currently uses a fixed borrow-rate proxy of 0.0004%/hr annualized to APR."
    ]
  };
}
