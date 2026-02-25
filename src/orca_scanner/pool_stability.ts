import fs from "node:fs/promises";
import path from "node:path";
import type { OrcaApiPool } from "./types.js";

type PoolSnapshotRow = {
  poolAddress: string;
  tvlUsd: number;
  volume24hUsd: number;
};

type PoolSnapshot = {
  ts: string;
  pools: PoolSnapshotRow[];
};

export type PoolStabilityMetric = {
  stabilityScore: number;
  meanVolTvl7d: number;
  stdevVolTvl7d: number;
  stabilityNote?: string;
};

const HISTORY_PATH = path.resolve(process.cwd(), "data/orca_pool_stats_history.jsonl");

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

async function ensureHistoryFile() {
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  try {
    await fs.access(HISTORY_PATH);
  } catch {
    await fs.writeFile(HISTORY_PATH, "", "utf8");
  }
}

async function readSnapshots(): Promise<PoolSnapshot[]> {
  await ensureHistoryFile();
  const raw = await fs.readFile(HISTORY_PATH, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PoolSnapshot;
      } catch {
        return null;
      }
    })
    .filter((x): x is PoolSnapshot => Boolean(x));
}

export async function appendPoolStatsSnapshot(pools: OrcaApiPool[]): Promise<string> {
  await ensureHistoryFile();
  const snapshot: PoolSnapshot = {
    ts: new Date().toISOString(),
    pools: pools.map((p) => ({
      poolAddress: p.address,
      tvlUsd: Number(p.tvlUsd) || 0,
      volume24hUsd: Number(p.stats24h.volume) || 0
    }))
  };
  await fs.appendFile(HISTORY_PATH, `${JSON.stringify(snapshot)}\n`, "utf8");
  return HISTORY_PATH;
}

export async function computePoolStabilityMetrics(windowDays = 7): Promise<Map<string, PoolStabilityMetric>> {
  const snapshots = await readSnapshots();
  const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const recent = snapshots.filter((s) => {
    const t = Date.parse(s.ts);
    return Number.isFinite(t) && t >= cutoffMs;
  });

  const byPoolByDay = new Map<string, Map<string, number[]>>();
  for (const snap of recent) {
    const day = String(snap.ts).slice(0, 10);
    for (const row of snap.pools) {
      const volTvl = row.tvlUsd > 0 ? row.volume24hUsd / row.tvlUsd : 0;
      if (!byPoolByDay.has(row.poolAddress)) byPoolByDay.set(row.poolAddress, new Map());
      const dayMap = byPoolByDay.get(row.poolAddress)!;
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day)!.push(volTvl);
    }
  }

  const out = new Map<string, PoolStabilityMetric>();
  for (const [poolAddress, dayMap] of byPoolByDay.entries()) {
    const daily = [...dayMap.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-windowDays)
      .map(([, vals]) => vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length))
      .filter((x) => Number.isFinite(x));

    const mean = daily.length ? daily.reduce((a, b) => a + b, 0) / daily.length : 0;
    const sd = daily.length > 1 ? stddev(daily) : 0;

    if (!Number.isFinite(mean) || mean <= 0 || daily.length < 2) {
      out.set(poolAddress, {
        stabilityScore: 0.25,
        meanVolTvl7d: Number.isFinite(mean) ? mean : 0,
        stdevVolTvl7d: Number.isFinite(sd) ? sd : 0,
        stabilityNote: "Insufficient/non-positive 7d vol/TVL history; defaulted stability score to 0.25"
      });
      continue;
    }

    const score = 1 / (1 + sd / mean);
    out.set(poolAddress, {
      stabilityScore: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
      meanVolTvl7d: Number(mean.toFixed(6)),
      stdevVolTvl7d: Number(sd.toFixed(6))
    });
  }
  return out;
}

export { HISTORY_PATH as ORCA_POOL_STATS_HISTORY_PATH };
