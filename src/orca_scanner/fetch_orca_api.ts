import type { OrcaApiPool, OrcaPoolStatsWindow } from "./types.js";

type OrcaApiResponse = {
  data?: unknown[];
  meta?: {
    cursor?: {
      previous?: string | null;
      next?: string | null;
    };
  };
};

const ORCA_POOLS_API = "https://api.orca.so/v2/solana/pools";

function toNum(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function mapStatsWindow(raw: any): OrcaPoolStatsWindow {
  return {
    volume: toNum(raw?.volume),
    fees: toNum(raw?.fees),
    rewards: toNum(raw?.rewards),
    yieldOverTvl: toNum(raw?.yieldOverTvl)
  };
}

function mapPool(raw: any): OrcaApiPool {
  const feeRate = toNum(raw?.feeRate);
  const liquidity = toNum(raw?.liquidity);
  const rewards = Array.isArray(raw?.rewards) ? raw.rewards : [];
  const activeRewards = rewards.filter((r: any) => {
    const eps = toNum(r?.emissionsPerSecond);
    return Boolean(r?.active) || eps > 0;
  });

  return {
    address: String(raw?.address ?? ""),
    poolType: String(raw?.poolType ?? ""),
    tickSpacing: Math.trunc(toNum(raw?.tickSpacing)),
    feeRate,
    feeTierRate: feeRate / 1_000_000,
    liquidityRaw: String(raw?.liquidity ?? "0"),
    liquidity,
    sqrtPriceRaw: raw?.sqrtPrice != null ? String(raw.sqrtPrice) : undefined,
    tickCurrentIndex:
      raw?.tickCurrentIndex == null || !Number.isFinite(Number(raw.tickCurrentIndex))
        ? undefined
        : Math.trunc(Number(raw.tickCurrentIndex)),
    price: raw?.price == null ? null : toNum(raw?.price, Number.NaN),
    tvlUsd: toNum(raw?.tvlUsdc),
    tokenA: {
      address: String(raw?.tokenA?.address ?? raw?.tokenMintA ?? ""),
      symbol: String(raw?.tokenA?.symbol ?? ""),
      name: raw?.tokenA?.name ? String(raw.tokenA.name) : undefined,
      decimals: Number.isFinite(Number(raw?.tokenA?.decimals)) ? Number(raw.tokenA.decimals) : undefined
    },
    tokenB: {
      address: String(raw?.tokenB?.address ?? raw?.tokenMintB ?? ""),
      symbol: String(raw?.tokenB?.symbol ?? ""),
      name: raw?.tokenB?.name ? String(raw.tokenB.name) : undefined,
      decimals: Number.isFinite(Number(raw?.tokenB?.decimals)) ? Number(raw.tokenB.decimals) : undefined
    },
    stats24h: mapStatsWindow(raw?.stats?.["24h"]),
    stats7d: mapStatsWindow(raw?.stats?.["7d"]),
    stats30d: mapStatsWindow(raw?.stats?.["30d"]),
    rewardsActiveCount: activeRewards.length,
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined
  };
}

async function fetchPoolsPage(cursor?: string): Promise<OrcaApiResponse> {
  const url = new URL(ORCA_POOLS_API);
  url.searchParams.set("size", "500");
  url.searchParams.set("sortBy", "tvl");
  url.searchParams.set("sortDirection", "desc");
  if (cursor) url.searchParams.set("cursor", cursor);

  const res = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`orca-api:${res.status}:${body.slice(0, 300)}`);
  }
  return (await res.json()) as OrcaApiResponse;
}

export async function fetchAllOrcaWhirlpools(maxPages = 20): Promise<OrcaApiPool[]> {
  const byAddress = new Map<string, OrcaApiPool>();
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await fetchPoolsPage(cursor);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    for (const raw of rows) {
      const pool = mapPool(raw);
      if (!pool.address || pool.poolType !== "whirlpool") continue;
      byAddress.set(pool.address, pool);
    }
    const nextCursor = payload.meta?.cursor?.next ?? undefined;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return [...byAddress.values()].sort((a, b) => b.tvlUsd - a.tvlUsd);
}
