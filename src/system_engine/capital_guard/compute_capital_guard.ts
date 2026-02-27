import type { HealthResult } from "../health/compute_health.js";

export type CapitalGuardLevel = "none" | "warning" | "action" | "critical";

export type CapitalGuardResult = {
  level: CapitalGuardLevel;
  triggers: string[];
};

type CapitalGuardSnapshotInput = {
  exposures: {
    hedgeRatio: number;
  };
  liquidation: {
    liqBufferRatio: number | null;
  };
  range: {
    rangeBufferRatio: number | null;
  };
};

export function computeCapitalGuard(
  snapshot: CapitalGuardSnapshotInput,
  health: HealthResult
): CapitalGuardResult {
  const triggers: string[] = [];

  const liq = snapshot.liquidation.liqBufferRatio;
  if (liq != null && liq < 0.05) triggers.push("immediate_action");
  else if (liq != null && liq < 0.1) triggers.push("reduce_exposure");

  const hedge = snapshot.exposures.hedgeRatio;
  if (hedge < 0.5) triggers.push("critical_unhedged");
  else if (hedge < 0.7) triggers.push("rebalance_required");

  const range = snapshot.range.rangeBufferRatio;
  if (range != null && range < 0.05) triggers.push("range_exit_risk");

  if (health.overall === "critical") triggers.push("capital_at_risk");

  const hasCritical = triggers.includes("immediate_action")
    || triggers.includes("critical_unhedged")
    || triggers.includes("capital_at_risk");
  const hasAction = triggers.includes("reduce_exposure")
    || triggers.includes("rebalance_required");
  const hasWarning = triggers.includes("range_exit_risk");

  const level: CapitalGuardLevel = hasCritical
    ? "critical"
    : hasAction
      ? "action"
      : hasWarning
        ? "warning"
        : "none";

  return {
    level,
    triggers
  };
}
