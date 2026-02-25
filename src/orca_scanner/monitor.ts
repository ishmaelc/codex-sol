import { getOperatorMode, normalizeCadenceHours } from "../portfolio/operator_mode.js";
import type { AlertsOutput, OrcaAlert, PlansOutput, PoolRankingOutput, RegimeState, ShortlistOutput } from "./types.js";

function mkAlert(a: OrcaAlert): OrcaAlert {
  return a;
}

export function buildAlerts(args: {
  regime: RegimeState;
  rankings: PoolRankingOutput;
  shortlist: ShortlistOutput;
  plans: PlansOutput;
  monitorCadenceHours?: number;
}): AlertsOutput {
  const alerts: OrcaAlert[] = [];
  const topByAddress = new Map((args.rankings.topPoolsOverall ?? args.rankings.pools).map((p) => [p.poolAddress, p]));
  const operatorMode = getOperatorMode(normalizeCadenceHours(args.monitorCadenceHours));

  const funding = args.regime.metrics.fundingAprPct;
  if (funding != null && funding >= 15) {
    alerts.push(
      mkAlert({
        id: "funding-spike",
        severity: funding >= 25 ? "critical" : "warn",
        kind: "FUNDING_SPIKE",
        message: `Funding proxy is elevated at ${funding.toFixed(2)}% APR.`,
        metric: { name: "fundingAprPct", value: funding, threshold: 15 }
      })
    );
  }

  for (const item of args.shortlist.selected) {
    const row = topByAddress.get(item.poolAddress);
    if (!row) continue;
    const volTvlPct = row.volumeTvl * 100;
    const depthRatioPct = (row.depthTvl1PctRatio ?? 0) * 100;

    if (volTvlPct < 6) {
      alerts.push(
        mkAlert({
          id: `vol-collapse-${row.poolAddress}`,
          severity: volTvlPct < 3 ? "critical" : "warn",
          kind: "VOLUME_TVL_COLLAPSE",
          poolAddress: row.poolAddress,
          pool: row.pool,
          message: `${row.pool} turnover is weak (${volTvlPct.toFixed(1)}% vol/TVL 24h).`,
          metric: { name: "volumeTvlPct", value: Number(volTvlPct.toFixed(2)), threshold: 6 }
        })
      );
    }

    if (row.tvlUsd < 200_000) {
      alerts.push(
        mkAlert({
          id: `tvl-flight-${row.poolAddress}`,
          severity: row.tvlUsd < 120_000 ? "critical" : "warn",
          kind: "TVL_FLIGHT",
          poolAddress: row.poolAddress,
          pool: row.pool,
          message: `${row.pool} TVL is near thin-pool territory ($${Math.round(row.tvlUsd).toLocaleString()}).`,
          metric: { name: "tvlUsd", value: row.tvlUsd, threshold: 200_000 }
        })
      );
    }

    if (depthRatioPct < 2) {
      alerts.push(
        mkAlert({
          id: `depth-collapse-${row.poolAddress}`,
          severity: depthRatioPct < 1 ? "critical" : "warn",
          kind: "DEPTH_COLLAPSE",
          poolAddress: row.poolAddress,
          pool: row.pool,
          message: `${row.pool} depth has fallen to ${depthRatioPct.toFixed(2)}% of TVL at ±1%.`,
          metric: { name: "depthTvl1PctRatioPct", value: Number(depthRatioPct.toFixed(2)), threshold: 2 }
        })
      );
    }

    const plan = args.plans.plans.find((p) => p.poolAddress === row.poolAddress);
    const preferredLabel = plan?.recommendedPreset ?? "Base";
    const preferred = plan?.presets.find((p) => p.label === preferredLabel) ?? plan?.presets.find((p) => p.label === "Base");
    if (plan?.spotPrice && preferred && preferred.upperPrice && preferred.lowerPrice) {
      const span = preferred.upperPrice - preferred.lowerPrice;
      const distToEdge = Math.min(plan.spotPrice - preferred.lowerPrice, preferred.upperPrice - plan.spotPrice);
      const edgePct = span > 0 ? distToEdge / span : 0.5;
      if (edgePct <= operatorMode.actEdgePct) {
        alerts.push(
          mkAlert({
            id: `range-edge-action-${row.poolAddress}`,
            severity: "critical",
            kind: "RANGE_EDGE_ACTION",
            poolAddress: row.poolAddress,
            pool: row.pool,
            message: `${row.pool} is at action edge threshold (${(edgePct * 100).toFixed(1)}% <= ${(operatorMode.actEdgePct * 100).toFixed(1)}%).`,
            metric: { name: "distanceToEdgePct", value: Number((edgePct * 100).toFixed(2)), threshold: operatorMode.actEdgePct * 100 }
          })
        );
      } else if (edgePct <= operatorMode.warnEdgePct) {
        alerts.push(
          mkAlert({
            id: `range-edge-warn-${row.poolAddress}`,
            severity: "warn",
            kind: "RANGE_EDGE_WARN",
            poolAddress: row.poolAddress,
            pool: row.pool,
            message: `${row.pool} is near edge warning threshold (${(edgePct * 100).toFixed(1)}% <= ${(operatorMode.warnEdgePct * 100).toFixed(1)}%).`,
            metric: { name: "distanceToEdgePct", value: Number((edgePct * 100).toFixed(2)), threshold: operatorMode.warnEdgePct * 100 }
          })
        );
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    regime: args.regime.regime,
    alerts,
    notes: [
      "Threshold-based monitor. Alerts are heuristic and intended for weekly-active LP workflows.",
      `Operator mode cadence=${operatorMode.monitorCadenceHours}h warnEdge<=${(operatorMode.warnEdgePct * 100).toFixed(1)}% action<=${(operatorMode.actEdgePct * 100).toFixed(1)}%`
    ]
  };
}
