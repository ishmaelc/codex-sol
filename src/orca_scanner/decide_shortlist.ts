import type { PoolRankingOutput, RankedPool, RegimeState, ShortlistDecisionReason, ShortlistItem, ShortlistOutput } from "./types.js";

const SHORTLIST_MAX = 1 as const;
const MIN_DEPTH_TVL_1PCT_RATIO = 0.015;
const MIN_TVL_USD = 150_000;
const MIN_VOLUME_24H_USD = 75_000;

function isVisibleType(type: RankedPool["type"]): type is Exclude<RankedPool["type"], "STABLE-STABLE"> {
  return type !== "STABLE-STABLE";
}

function depthRatio(pool: RankedPool): number {
  if (pool.depthTvl1PctRatio != null) return pool.depthTvl1PctRatio;
  if (pool.depthUsd1Pct != null && pool.tvlUsd > 0) return pool.depthUsd1Pct / pool.tvlUsd;
  return 0;
}

function passesGuardrails(pool: RankedPool): { ok: boolean; reasons: ShortlistDecisionReason[] } {
  const reasons: ShortlistDecisionReason[] = [];
  const dRatio = depthRatio(pool);
  if (pool.tvlUsd < MIN_TVL_USD) {
    reasons.push({ code: "GUARDRAIL_FAIL", message: `TVL below guardrail ($${Math.round(pool.tvlUsd).toLocaleString()})` });
  }
  if (pool.volume24hUsd < MIN_VOLUME_24H_USD) {
    reasons.push({ code: "THIN_POOL_REJECT", message: `24h volume too low ($${Math.round(pool.volume24hUsd).toLocaleString()})` });
  }
  if (dRatio < MIN_DEPTH_TVL_1PCT_RATIO) {
    reasons.push({ code: "THIN_POOL_REJECT", message: `Depth/TLV(±1%) ratio too low (${(dRatio * 100).toFixed(2)}%)` });
  } else {
    reasons.push({ code: "DEPTH_OK", message: `Depth/TLV(±1%) ratio ${(dRatio * 100).toFixed(2)}%` });
  }
  return { ok: reasons.every((r) => r.code !== "GUARDRAIL_FAIL" && r.code !== "THIN_POOL_REJECT"), reasons };
}

function rankKey(pool: RankedPool): number {
  const d = depthRatio(pool);
  return pool.score + Math.min(pool.feeAprPct / 5, 20) + Math.min(d * 200, 10);
}

function toItem(slot: 1 | 2, pool: RankedPool, extra: ShortlistDecisionReason[]): ShortlistItem {
  return {
    slot,
    poolAddress: pool.poolAddress,
    pool: pool.pool,
    type: pool.type as Exclude<RankedPool["type"], "STABLE-STABLE">,
    rank: pool.rank,
    score: pool.score,
    tvlUsd: pool.tvlUsd,
    volume24hUsd: pool.volume24hUsd,
    feeAprPct: pool.feeAprPct,
    depthUsd1Pct: pool.depthUsd1Pct,
    depthUsd2Pct: pool.depthUsd2Pct,
    depthTvl1PctRatio: pool.depthTvl1PctRatio ?? (pool.depthUsd1Pct != null && pool.tvlUsd > 0 ? pool.depthUsd1Pct / pool.tvlUsd : undefined),
    reasons: extra
  };
}

export function decideShortlist(args: { regime: RegimeState; rankings: PoolRankingOutput }): ShortlistOutput {
  const source = (args.rankings.topPoolsOverall ?? args.rankings.pools ?? []).filter((p) => isVisibleType(p.type));
  const screened = source.map((pool) => ({ pool, guard: passesGuardrails(pool) }));
  const passing = screened
    .filter((x) => x.guard.ok)
    .map((x) => x.pool)
    .sort((a, b) => rankKey(b) - rankKey(a))
    .slice(0, SHORTLIST_MAX);

  const selected: ShortlistItem[] = [];
  const used = new Set<string>();
  const add = (pool: RankedPool | undefined, reasons: ShortlistDecisionReason[]) => {
    if (!pool || used.has(pool.poolAddress) || selected.length >= SHORTLIST_MAX) return;
    selected.push(toItem((selected.length + 1) as 1 | 2, pool, reasons));
    used.add(pool.poolAddress);
  };

  for (const p of passing) {
    add(p, [
      {
        code: "REGIME_MATCH",
        message: `Selected by final score under current regime risk settings (range/hedge/alerts remain regime-aware).`
      },
      {
        code: "TYPE_TARGET",
        message: "Type-neutral shortlist: ranked on feeAPR, volume/TVL, depth, and stability after guardrails."
      }
    ]);
  }

  return {
    generatedAt: new Date().toISOString(),
    regime: args.regime.regime,
    maxPools: SHORTLIST_MAX,
    selected,
    constraints: {
      minDepthTvl1PctRatio: MIN_DEPTH_TVL_1PCT_RATIO,
      minTvlUsd: MIN_TVL_USD,
      minVolume24hUsd: MIN_VOLUME_24H_USD
    },
    summary: {
      candidatesConsidered: source.length,
      selectedCount: selected.length
    },
    notes: [
      "Shortlist is capped at 2 concurrent pools by design.",
      selected.length < SHORTLIST_MAX
        ? `Only ${selected.length} pool(s) passed guardrails; shortlist returns fewer than 2 with explanation.`
        : "Two top-scoring pools selected under guardrails (type-neutral)."
    ]
  };
}
