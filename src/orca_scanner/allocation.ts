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
  } else {
    weightHints = selected.map((s) => Math.max(0, s.score));
    rationale.push("Type-neutral allocation: weights derived from relative scores.");
  }

  const weights = normalizeWeights(weightHints.map((w) => ({ w })));
  const allocations = selected.map((s, i) => ({
    poolAddress: s.poolAddress,
    pool: s.pool,
    type: s.type,
    weightPct: weights[i] ?? 0,
    rationale: "Type-neutral allocation: weights derived from relative scores."
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
