import type { PoolRankingOutput, RankedPool, RegimeState, ShortlistDecisionReason, ShortlistItem, ShortlistOutput } from "./types.js";

const SHORTLIST_MAX = 2 as const;
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

function pickBest(candidates: RankedPool[], used: Set<string>): RankedPool | undefined {
  return candidates.filter((p) => !used.has(p.poolAddress)).sort((a, b) => rankKey(b) - rankKey(a))[0];
}

export function decideShortlist(args: { regime: RegimeState; rankings: PoolRankingOutput }): ShortlistOutput {
  const source = (args.rankings.topPoolsOverall ?? args.rankings.pools ?? []).filter((p) => isVisibleType(p.type));
  const screened = source
    .map((pool) => ({ pool, guard: passesGuardrails(pool) }))
    .filter((x) => x.guard.ok)
    .map((x) => x.pool);

  const byType = {
    "SOL-STABLE": screened.filter((p) => p.type === "SOL-STABLE"),
    "SOL-LST": screened.filter((p) => p.type === "SOL-LST"),
    "LST-STABLE": screened.filter((p) => p.type === "LST-STABLE"),
    "LST-LST": screened.filter((p) => p.type === "LST-LST")
  };

  const selected: ShortlistItem[] = [];
  const used = new Set<string>();
  const add = (pool: RankedPool | undefined, reasons: ShortlistDecisionReason[]) => {
    if (!pool || used.has(pool.poolAddress) || selected.length >= SHORTLIST_MAX) return;
    selected.push(toItem((selected.length + 1) as 1 | 2, pool, reasons));
    used.add(pool.poolAddress);
  };

  const exceptionalSolStable = byType["SOL-STABLE"].find(
    (p) => (p.depthTvl1PctRatio ?? 0) >= 0.025 && p.feeAprPct >= 25 && p.score >= 75
  );

  if (args.regime.regime === "LOW") {
    add(pickBest([...byType["SOL-LST"], ...byType["LST-STABLE"]], used), [
      { code: "REGIME_MATCH", message: "LOW regime: prefer carry-ish LST-linked pool" },
      { code: "TYPE_TARGET", message: "Targeting SOL-LST or LST-STABLE exposure" }
    ]);
    add(exceptionalSolStable, [
      { code: "EXCEPTIONAL_SOL_STABLE", message: "LOW regime exception: SOL-STABLE retained due to strong depth + feeAPR" },
      { code: "REGIME_MATCH", message: "Optional second slot only for exceptional SOL-STABLE quality" }
    ]);
  } else if (args.regime.regime === "MODERATE") {
    add(pickBest(byType["SOL-STABLE"], used), [
      { code: "REGIME_MATCH", message: "MODERATE regime: target one SOL-STABLE anchor" },
      { code: "TYPE_TARGET", message: "Balanced slot 1 = SOL-STABLE" }
    ]);
    add(pickBest([...byType["SOL-LST"], ...byType["LST-STABLE"]], used), [
      { code: "REGIME_MATCH", message: "MODERATE regime: second slot favors LST-linked carry" },
      { code: "TYPE_TARGET", message: "Balanced slot 2 = SOL-LST or LST-STABLE" }
    ]);
  } else {
    add(pickBest(byType["SOL-STABLE"], used), [
      { code: "REGIME_MATCH", message: "HIGH regime: prefer SOL-STABLE with strongest depth + feeAPR" }
    ]);
    add(pickBest(byType["SOL-STABLE"], used), [
      { code: "REGIME_MATCH", message: "HIGH regime: second SOL-STABLE slot for high-turnover conditions" }
    ]);
  }

  if (selected.length < SHORTLIST_MAX) {
    const fallback = screened
      .filter((p) => !used.has(p.poolAddress))
      .sort((a, b) => rankKey(b) - rankKey(a));
    for (const p of fallback) {
      add(p, [
        { code: "TYPE_TARGET", message: "Fallback selection due to limited qualifying pools" },
        { code: "REGIME_MATCH", message: `Regime ${args.regime.regime} produced fewer than ${SHORTLIST_MAX} ideal candidates` }
      ]);
      if (selected.length >= SHORTLIST_MAX) break;
    }
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
        ? `Only ${selected.length} pool(s) passed regime fit + guardrails.`
        : "Two pools selected under regime rules and guardrails."
    ]
  };
}
