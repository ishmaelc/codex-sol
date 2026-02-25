import { buildAllocationRecommendation } from "./allocation.js";
import { computeRegimeState } from "./compute_regime.js";
import { decideShortlist } from "./decide_shortlist.js";
import { fetchAllOrcaWhirlpools } from "./fetch_orca_api.js";
import { fetchSolFundingProxyFromJupiter } from "./fetch_funding.js";
import { enrichPoolsOnchain } from "./fetch_orca_onchain.js";
import { applyHedgePlans } from "./hedge_planner.js";
import { buildAlerts } from "./monitor.js";
import { ensurePerformanceArtifacts, writePerformanceSummary } from "./performance.js";
import { appendPoolStatsSnapshot, computePoolStabilityMetrics } from "./pool_stability.js";
import { buildRangePlans } from "./range_planner.js";
import { buildPoolRankings, selectThresholdPools, selectUniversePools } from "./rank_pools.js";
import { writeOrcaOutputs } from "./write_outputs.js";
import { runPortfolioEngine } from "../portfolio/engine.js";

async function main() {
  console.log("[orca] fetching Orca whirlpools...");
  const pools = await fetchAllOrcaWhirlpools();
  console.log(`[orca] fetched ${pools.length} whirlpools`);

  const universePools = selectUniversePools(pools);
  const thresholdPools = selectThresholdPools(pools);
  console.log(`[orca] universe ${universePools.length}, threshold-passing ${thresholdPools.length}`);

  await appendPoolStatsSnapshot(pools);
  const stabilityByPool = await computePoolStabilityMetrics(7);
  console.log(`[orca] stability metrics computed for ${stabilityByPool.size} pools (7d vol/TVL history)`);

  const [funding, onchainByPool] = await Promise.all([
    fetchSolFundingProxyFromJupiter(),
    enrichPoolsOnchain(thresholdPools)
  ]);

  if (funding.fundingAprPct == null) {
    console.warn(`[orca] funding proxy unavailable (${funding.source}): ${funding.note ?? "n/a"}`);
  } else {
    console.log(`[orca] funding proxy ${funding.fundingAprPct.toFixed(2)}% APR (${funding.source})`);
  }

  const regimeState = await computeRegimeState({
    poolsForTurnover: universePools,
    funding
  });
  console.log(`[orca] regime ${regimeState.regime} (score=${regimeState.score}, conf=${regimeState.confidence})`);

  const poolRankings = buildPoolRankings({
    fetchedPools: pools,
    regime: regimeState,
    onchainByPool,
    stabilityByPool
  });
  console.log(`[orca] ranked ${poolRankings.topPoolsOverall.length} visible pools`);

  const shortlist = decideShortlist({ regime: regimeState, rankings: poolRankings });
  console.log(`[orca] shortlist selected ${shortlist.selected.length}/${shortlist.maxPools}`);

  const spotByPool = new Map<string, number | undefined>(
    (poolRankings.topPoolsOverall ?? poolRankings.pools).map((p) => [p.poolAddress, p.spotPrice])
  );
  const rankingByPool = new Map((poolRankings.topPoolsOverall ?? poolRankings.pools).map((p) => [p.poolAddress, p]));
  const rangePlansWithMeta = buildRangePlans({ shortlist, regime: regimeState, spotByPool, rankingByPool });
  const solSpotUsd =
    (poolRankings.topPoolsOverall ?? poolRankings.pools).find((p) => p.type === "SOL-STABLE" && p.spotPrice && p.spotPrice > 1)
      ?.spotPrice ?? undefined;
  const plans = applyHedgePlans({
    ...rangePlansWithMeta,
    notes: [
      "Range presets are weekly-active heuristics around current spot using regime + pool-type volatility proxies.",
      "Hedges are normalized per $10k deployed and use the fixed funding APR proxy."
    ]
  }, { solSpotUsd, rankingByPool });
  console.log(`[orca] built plans for ${plans.plans.length} shortlisted pools`);

  const allocation = buildAllocationRecommendation({ regime: regimeState, shortlist, rankings: poolRankings });
  console.log(`[orca] allocation rows ${allocation.allocations.length}`);

  const alerts = buildAlerts({ regime: regimeState, rankings: poolRankings, shortlist, plans });
  console.log(`[orca] alerts ${alerts.alerts.length}`);

  await ensurePerformanceArtifacts();
  const { output: performance } = await writePerformanceSummary(7);

  const out = await writeOrcaOutputs({
    regimeState,
    poolRankings,
    shortlist,
    plans,
    allocation,
    alerts,
    performance
  });
  console.log(`[orca] wrote ${out.regimePath}`);
  console.log(`[orca] wrote ${out.rankingsPath}`);

  const portfolioOut = await runPortfolioEngine();
  console.log(`[portfolio] wrote ${portfolioOut.indexPath} and ${portfolioOut.systemPaths.length} system snapshots`);
}

main().catch((err) => {
  console.error("[orca] refresh failed:", err);
  process.exitCode = 1;
});
