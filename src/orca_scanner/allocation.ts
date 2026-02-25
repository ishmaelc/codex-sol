import type { AllocationOutput, PoolRankingOutput, RegimeState, ShortlistOutput } from "./types.js";

function normalizeWeights(items: Array<{ w: number }>): number[] {
  const sum = items.reduce((a, b) => a + Math.max(0, b.w), 0);
  if (sum <= 0) return items.map(() => 0);
  const raw = items.map((x) => (Math.max(0, x.w) / sum) * 100);
  const rounded = raw.map((x) => Math.round(x));
  let diff = 100 - rounded.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rounded.length && diff !== 0; i += 1) {
    rounded[i] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  return rounded;
}

export function buildAllocationRecommendation(args: {
  regime: RegimeState;
  shortlist: ShortlistOutput;
  rankings: PoolRankingOutput;
}): AllocationOutput {
  const selected = args.shortlist.selected;
  const topRows = new Map((args.rankings.topPoolsOverall ?? args.rankings.pools).map((p) => [p.poolAddress, p]));
  const rationale: string[] = [];

  if (selected.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      regime: args.regime.regime,
      maxPools: 2,
      allocations: [],
      rationale: ["No shortlisted pools available for allocation."],
      notes: ["Allocation is only produced for shortlisted pools (max 2)."]
    };
  }

  let weightHints = selected.map(() => 1);
  if (selected.length === 1) {
    weightHints = [1];
    rationale.push("Only one pool qualified; allocate 100% to the sole shortlist pool.");
  } else if (args.regime.regime === "LOW") {
    const carryIdx = selected.findIndex((x) => x.type === "SOL-LST" || x.type === "LST-STABLE");
    const solStableIdx = selected.findIndex((x) => x.type === "SOL-STABLE");
    if (carryIdx >= 0 && solStableIdx >= 0) {
      weightHints = selected.map((_, i) => (i === carryIdx ? 60 : i === solStableIdx ? 40 : 0));
      rationale.push("LOW regime: 60% carry-ish (SOL-LST/LST-STABLE), 40% SOL-STABLE anchor.");
    } else if (solStableIdx >= 0) {
      weightHints = selected.map((_, i) => (i === solStableIdx ? 100 : 0));
      rationale.push("LOW regime: only SOL-STABLE available among preferred types, allocate 100% SOL-STABLE.");
    } else {
      weightHints = selected.map((_, i) => (i === 0 ? 60 : 40));
      rationale.push("LOW regime fallback: overweight first non-SOL-STABLE shortlisted pool.");
    }
  } else if (args.regime.regime === "MODERATE") {
    weightHints = selected.map(() => 50);
    rationale.push("MODERATE regime: balanced 50/50 split across two shortlisted pools.");
  } else {
    const scored = selected
      .map((s, i) => {
        const row = topRows.get(s.poolAddress);
        const depthScore = (row?.depthUsd1Pct ?? 0) + 0.5 * (row?.depthUsd2Pct ?? 0);
        return { idx: i, type: s.type, composite: depthScore + s.score * 1_000 };
      })
      .sort((a, b) => b.composite - a.composite);
    const first = scored[0];
    const second = scored[1];
    if (first && second) {
      const secondCap = second.type === "SOL-STABLE" ? 30 : 20;
      weightHints = selected.map((_, i) => (i === first.idx ? 100 - secondCap : i === second.idx ? secondCap : 0));
      rationale.push(
        second.type === "SOL-STABLE"
          ? "HIGH regime: 70/30 split toward deepest/highest-score SOL-STABLE pair."
          : "HIGH regime: second pool is not SOL-STABLE, capped at 20%."
      );
    }
  }

  const weights = normalizeWeights(weightHints.map((w) => ({ w })));
  const allocations = selected.map((s, i) => ({
    poolAddress: s.poolAddress,
    pool: s.pool,
    type: s.type,
    weightPct: weights[i] ?? 0,
    rationale:
      args.regime.regime === "HIGH" && s.type !== "SOL-STABLE"
        ? "Secondary non-SOL-STABLE capped in HIGH regime."
        : `${args.regime.regime} regime allocation rule`
  }));

  return {
    generatedAt: new Date().toISOString(),
    regime: args.regime.regime,
    maxPools: 2,
    allocations,
    rationale,
    notes: ["Allocation is a recommendation layer on top of the shortlist, capped at 2 pools."]
  };
}
